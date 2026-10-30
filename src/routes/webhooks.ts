import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { requireAuth } from '../middleware/require-auth';
import { requireTenant } from '../middleware/require-tenant';
import { env } from '../config/env';
import { supabaseAdmin } from '../lib/supabase';
import { PLAN_LIMITS, resolvePlanBooleanLimit, type PlanName } from '../config/plans';
import {
  WEBHOOK_EVENTS,
  buildWebhookBody,
  dispatchDueWebhooks,
  generateWebhookSecret,
  postWebhook,
  validateWebhookUrl,
} from '../lib/webhooks';

export const webhooksRouter = Router();

const upsertSchema = z.object({
  url: z.string().trim().min(1).max(2000),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional(),
  enabled: z.boolean().optional(),
});

const deliveriesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: z.enum(['pending', 'succeeded', 'failed']).optional(),
});

const ENDPOINT_COLUMNS = 'id, url, secret, events, enabled, created_at, updated_at';

function requireWebhooksPlan(request: Request, response: Response, next: NextFunction): void {
  const plan = (request.tenant?.plan ?? 'free') as PlanName;
  const planLimits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
  if (!resolvePlanBooleanLimit(request.tenant?.can_use_webhooks, planLimits.can_use_webhooks)) {
    response.status(403).json({ error: 'Webhooks are not included in your plan.' });
    return;
  }
  next();
}

webhooksRouter.use(requireAuth, requireTenant);

// GET /v1/webhooks — the tenant's endpoint (or null) and the event catalogue
webhooksRouter.get('/', async (request, response) => {
  const { data, error } = await supabaseAdmin
    .from('webhook_endpoints')
    .select(ENDPOINT_COLUMNS)
    .eq('tenant_id', request.tenant?.id as string)
    .maybeSingle();

  if (error) {
    response.status(500).json({ error: 'Failed to load webhook' });
    return;
  }

  const plan = (request.tenant?.plan ?? 'free') as PlanName;
  const planLimits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;

  response.json({
    webhook: data ?? null,
    availableEvents: WEBHOOK_EVENTS,
    allowed: resolvePlanBooleanLimit(request.tenant?.can_use_webhooks, planLimits.can_use_webhooks),
  });
});

// PUT /v1/webhooks — create or update the single endpoint for this tenant
webhooksRouter.put('/', requireWebhooksPlan, async (request, response) => {
  const parsed = upsertSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
    return;
  }

  const urlError = validateWebhookUrl(parsed.data.url);
  if (urlError) {
    response.status(400).json({ error: urlError });
    return;
  }

  const tenantId = request.tenant?.id as string;
  const { data: existing } = await supabaseAdmin
    .from('webhook_endpoints')
    .select('id')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  const values: Record<string, unknown> = {
    url: parsed.data.url,
    updated_at: new Date().toISOString(),
  };
  if (parsed.data.events) values.events = parsed.data.events;
  if (parsed.data.enabled !== undefined) values.enabled = parsed.data.enabled;

  const query = existing
    ? supabaseAdmin.from('webhook_endpoints').update(values).eq('id', existing.id)
    : supabaseAdmin.from('webhook_endpoints').insert({ ...values, tenant_id: tenantId, secret: generateWebhookSecret() });

  const { data, error } = await query.select(ENDPOINT_COLUMNS).single();

  if (error) {
    response.status(500).json({ error: 'Failed to save webhook' });
    return;
  }

  response.status(existing ? 200 : 201).json({ webhook: data });
});

// DELETE /v1/webhooks — remove the endpoint (pending deliveries are dropped)
webhooksRouter.delete('/', async (request, response) => {
  const { error } = await supabaseAdmin
    .from('webhook_endpoints')
    .delete()
    .eq('tenant_id', request.tenant?.id as string);

  if (error) {
    response.status(500).json({ error: 'Failed to delete webhook' });
    return;
  }

  response.status(204).send();
});

// POST /v1/webhooks/rotate-secret — issue a new signing secret
webhooksRouter.post('/rotate-secret', requireWebhooksPlan, async (request, response) => {
  const { data, error } = await supabaseAdmin
    .from('webhook_endpoints')
    .update({ secret: generateWebhookSecret(), updated_at: new Date().toISOString() })
    .eq('tenant_id', request.tenant?.id as string)
    .select(ENDPOINT_COLUMNS)
    .maybeSingle();

  if (error) {
    response.status(500).json({ error: 'Failed to rotate secret' });
    return;
  }
  if (!data) {
    response.status(404).json({ error: 'No webhook configured' });
    return;
  }

  response.json({ webhook: data });
});

// POST /v1/webhooks/test — send a signed sample event right now (not retried)
webhooksRouter.post('/test', requireWebhooksPlan, async (request, response) => {
  const { data: endpoint } = await supabaseAdmin
    .from('webhook_endpoints')
    .select('url, secret')
    .eq('tenant_id', request.tenant?.id as string)
    .maybeSingle();

  if (!endpoint) {
    response.status(404).json({ error: 'No webhook configured' });
    return;
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  const body = buildWebhookBody({
    id,
    event_type: 'email.delivered',
    created_at: now,
    payload: {
      test: true,
      email_id: randomUUID(),
      from: 'reports@example.com',
      to: ['client@example.com'],
      cc: [],
      subject: 'Test event from Swayam Mail',
      email_type: 'transactional',
      campaign_id: null,
      source: 'api',
      tags: { example: 'true' },
      email_created_at: now,
      event_at: now,
      details: { email: 'client@example.com' },
    },
  });

  try {
    const statusCode = await postWebhook(endpoint.url, endpoint.secret, id, 'email.delivered', body);
    response.json({ ok: statusCode >= 200 && statusCode < 300, statusCode });
  } catch (error) {
    response.json({ ok: false, statusCode: null, error: error instanceof Error ? error.message : 'Request failed' });
  }
});

// GET /v1/webhooks/deliveries — recent delivery log
webhooksRouter.get('/deliveries', async (request, response) => {
  const parsed = deliveriesQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid query', issues: parsed.error.flatten() });
    return;
  }

  let query = supabaseAdmin
    .from('webhook_deliveries')
    .select('id, event_type, status, attempts, next_attempt_at, last_status_code, last_error, delivered_at, created_at, payload')
    .eq('tenant_id', request.tenant?.id as string)
    .order('created_at', { ascending: false })
    .limit(parsed.data.limit);

  if (parsed.data.status) {
    query = query.eq('status', parsed.data.status);
  }

  const { data, error } = await query;
  if (error) {
    response.status(500).json({ error: 'Failed to load deliveries' });
    return;
  }

  response.json({ deliveries: data ?? [] });
});

// POST /v1/webhooks/deliveries/:id/retry — queue a failed delivery again
webhooksRouter.post('/deliveries/:id/retry', requireWebhooksPlan, async (request, response) => {
  if (!z.string().uuid().safeParse(request.params.id).success) {
    response.status(400).json({ error: 'Invalid delivery id' });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from('webhook_deliveries')
    .update({ status: 'pending', next_attempt_at: new Date().toISOString(), locked_until: null })
    .eq('id', request.params.id)
    .eq('tenant_id', request.tenant?.id as string)
    .neq('status', 'pending')
    .select('id, status')
    .maybeSingle();

  if (error) {
    response.status(500).json({ error: 'Failed to retry delivery' });
    return;
  }
  if (!data) {
    response.status(404).json({ error: 'Delivery not found or already pending' });
    return;
  }

  response.json({ delivery: data });
});

// POST /internal/webhooks/dispatch — drain due deliveries once. For hosts
// without a long-running process, call this from a cron with x-internal-key.
export async function dispatchWebhooksHandler(request: Request, response: Response): Promise<void> {
  if (request.headers['x-internal-key'] !== env.INTERNAL_KEY) {
    response.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const attempted = await dispatchDueWebhooks(50);
  response.json({ attempted });
}
