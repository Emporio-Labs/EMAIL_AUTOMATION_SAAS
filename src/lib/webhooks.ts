import crypto from 'crypto';
import { isIP } from 'net';
import { env } from '../config/env';
import { supabaseAdmin } from './supabase';

// Rows are queued by database triggers on email_job_events (see migration
// 0015). This module signs and POSTs them, retrying with backoff.

const DISPATCH_INTERVAL_MS = 5_000;
const REQUEST_TIMEOUT_MS = 10_000;
// Delay before attempt N+1, in seconds. Seven tries spread over ~21 hours.
const RETRY_DELAYS_S = [60, 5 * 60, 30 * 60, 2 * 3600, 6 * 3600, 12 * 3600];
const MAX_ATTEMPTS = RETRY_DELAYS_S.length + 1;

export const WEBHOOK_EVENTS = [
  'email.sent',
  'email.delivered',
  'email.bounced',
  'email.complained',
  'email.opened',
  'email.clicked',
  'email.failed',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

type DeliveryRow = {
  id: string;
  tenant_id: string;
  endpoint_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  attempts: number;
  created_at: string;
};

export function generateWebhookSecret(): string {
  return `whsec_${crypto.randomBytes(24).toString('hex')}`;
}

/**
 * Signature header value: `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`.
 * Receivers recompute the HMAC with their secret and reject stale timestamps.
 */
export function signWebhookPayload(secret: string, body: string, timestamp: number): string {
  const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    return true;
  }
  if (isIP(host) === 4) {
    const [a, b] = host.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (isIP(host) === 6) {
    return host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80');
  }
  return false;
}

/** Returns an error message, or null when the URL is acceptable as a webhook target. */
export function validateWebhookUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'Webhook URL is not a valid URL';
  }
  if (url.protocol !== 'https:' && !(env.NODE_ENV !== 'production' && url.protocol === 'http:')) {
    return 'Webhook URL must use https';
  }
  if (env.NODE_ENV === 'production' && isPrivateHost(url.hostname)) {
    return 'Webhook URL must be publicly reachable';
  }
  return null;
}

export function buildWebhookBody(delivery: Pick<DeliveryRow, 'id' | 'event_type' | 'payload' | 'created_at'>): string {
  return JSON.stringify({
    id: delivery.id,
    type: delivery.event_type,
    created_at: delivery.created_at,
    data: delivery.payload,
  });
}

/** POSTs one signed body. Returns the HTTP status, or throws on network errors. */
export async function postWebhook(url: string, secret: string, deliveryId: string, eventType: string, body: string): Promise<number> {
  const timestamp = Math.floor(Date.now() / 1000);
  const response = await fetch(url, {
    method: 'POST',
    redirect: 'manual',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'SwayamMail-Webhooks/1.0',
      'Swayam-Event': eventType,
      'Swayam-Delivery-Id': deliveryId,
      'Swayam-Signature': signWebhookPayload(secret, body, timestamp),
    },
    body,
  });
  // Drain so the socket can be reused.
  await response.arrayBuffer().catch(() => undefined);
  return response.status;
}

async function attemptDelivery(delivery: DeliveryRow): Promise<void> {
  const { data: endpoint } = await supabaseAdmin
    .from('webhook_endpoints')
    .select('url, secret, enabled')
    .eq('id', delivery.endpoint_id)
    .maybeSingle();

  const attempts = delivery.attempts + 1;
  const now = new Date();

  if (!endpoint || !endpoint.enabled) {
    await supabaseAdmin
      .from('webhook_deliveries')
      .update({ status: 'failed', attempts, last_error: 'Webhook endpoint disabled or removed', locked_until: null })
      .eq('id', delivery.id);
    return;
  }

  let statusCode: number | null = null;
  let errorMessage: string | null = null;

  try {
    statusCode = await postWebhook(endpoint.url, endpoint.secret, delivery.id, delivery.event_type, buildWebhookBody(delivery));
    if (statusCode < 200 || statusCode >= 300) {
      errorMessage = `Endpoint responded with HTTP ${statusCode}`;
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : 'Request failed';
  }

  if (!errorMessage) {
    await supabaseAdmin
      .from('webhook_deliveries')
      .update({ status: 'succeeded', attempts, last_status_code: statusCode, last_error: null, delivered_at: now.toISOString(), locked_until: null })
      .eq('id', delivery.id);
    return;
  }

  const giveUp = attempts >= MAX_ATTEMPTS;
  const nextAttemptAt = giveUp ? now : new Date(now.getTime() + RETRY_DELAYS_S[attempts - 1] * 1000);

  await supabaseAdmin
    .from('webhook_deliveries')
    .update({
      status: giveUp ? 'failed' : 'pending',
      attempts,
      last_status_code: statusCode,
      last_error: errorMessage.slice(0, 500),
      next_attempt_at: nextAttemptAt.toISOString(),
      locked_until: null,
    })
    .eq('id', delivery.id);
}

/** Sends every due delivery once. Returns how many were attempted. */
export async function dispatchDueWebhooks(batchSize = 20): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc('claim_webhook_deliveries', { batch_size: batchSize });
  if (error) {
    console.error('[webhooks] Failed to claim deliveries:', error.message);
    return 0;
  }

  const deliveries = (data ?? []) as DeliveryRow[];
  await Promise.all(deliveries.map((delivery) =>
    attemptDelivery(delivery).catch((err) => console.error('[webhooks] Delivery error:', delivery.id, err)),
  ));
  return deliveries.length;
}

/** Starts the background dispatch loop. Called once on application startup. */
export function startWebhookDispatcher(): void {
  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      // Keep draining while full batches come back.
      while ((await dispatchDueWebhooks()) === 20) { /* continue */ }
    } finally {
      running = false;
    }
  }, DISPATCH_INTERVAL_MS);

  console.log('[webhooks] Dispatcher started — checking for due deliveries every 5 seconds.');
}
