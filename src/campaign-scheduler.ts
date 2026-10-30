/**
 * campaign-scheduler.ts
 *
 * Background job: starts campaigns whose scheduled_at has passed and sends
 * running campaigns in chunks through the normal /v1/send pipeline, so
 * suppression, quota, tracking and unsubscribe rules all apply.
 *
 * Progress lives in campaign_contacts.processed_at, so a paused campaign
 * resumes where it stopped and a restart never re-sends a recipient.
 */

import type { Request } from 'express';
import { supabaseAdmin } from './lib/supabase';
import { PLAN_LIMITS, resolvePlanLimit, type PlanName } from './config/plans';
import { handleSend, type SendResponse } from './routes/send';
import { processTenantLimits } from './utils/tenant-limits';

const TICK_INTERVAL_MS = 15 * 1000;
const MAX_CHUNK = 500;
// Per tick, per campaign; keeps one big campaign from starving the others.
const MAX_CHUNKS_PER_TICK = 10;

type CampaignRow = {
  id: string;
  tenant_id: string;
  subject: string | null;
  html: string | null;
  from_email: string | null;
};

type SendOutcome = { status: number; body: Record<string, any> };

function captureResponse(): { response: SendResponse; result: () => SendOutcome } {
  let status = 200;
  let body: Record<string, any> = {};
  const response: SendResponse = {
    status(code: number) {
      status = code;
      return {
        json(value: unknown) {
          body = (value ?? {}) as Record<string, any>;
          return value;
        },
      };
    },
    setHeader: () => undefined,
  };
  return { response, result: () => ({ status, body }) };
}

async function loadTenant(tenantId: string): Promise<Request['tenant'] | null> {
  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('id, name, slug, plan, rate_limit, monthly_email_limit, monthly_email_count, last_billing_reset, is_suspended, max_domains, max_sending_addresses, max_recipients_per_send, can_send_marketing, can_use_webhooks, can_track_opens, can_track_clicks, force_sandbox, trial_ends_at, internal_notes')
    .eq('id', tenantId)
    .maybeSingle();

  if (!tenant) return null;
  const limits = await processTenantLimits(tenant as any);

  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    role: 'scheduler',
    plan: limits.plan,
    rateLimit: limits.rateLimit,
    monthlyEmailLimit: limits.monthlyEmailLimit,
    monthlyEmailCount: limits.monthlyEmailCount,
    isSuspended: limits.isSuspended,
    max_domains: limits.max_domains,
    max_sending_addresses: limits.max_sending_addresses,
    max_recipients_per_send: limits.max_recipients_per_send,
    can_send_marketing: limits.can_send_marketing,
    can_use_webhooks: limits.can_use_webhooks,
    can_track_opens: limits.can_track_opens,
    can_track_clicks: limits.can_track_clicks,
    force_sandbox: limits.force_sandbox,
    trial_ends_at: limits.trial_ends_at,
    internal_notes: limits.internal_notes,
  };
}

async function setCampaign(id: string, fields: Record<string, unknown>): Promise<void> {
  await supabaseAdmin
    .from('campaigns')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id);
}

async function markProcessed(contactIds: string[], skippedReason: string | null): Promise<void> {
  for (let i = 0; i < contactIds.length; i += 150) {
    await supabaseAdmin
      .from('campaign_contacts')
      .update({ processed_at: new Date().toISOString(), skipped_reason: skippedReason })
      .in('id', contactIds.slice(i, i + 150));
  }
}

/** Sends one chunk. Returns false when the campaign should stop for this tick. */
async function sendChunk(campaign: CampaignRow): Promise<boolean> {
  // Re-read status each chunk so Pause takes effect within one chunk.
  const { data: current } = await supabaseAdmin
    .from('campaigns')
    .select('status')
    .eq('id', campaign.id)
    .maybeSingle();
  if (current?.status !== 'running') return false;

  const tenant = await loadTenant(campaign.tenant_id);
  if (!tenant || tenant.isSuspended) {
    await setCampaign(campaign.id, { status: 'paused', last_error: 'Account suspended' });
    return false;
  }

  if (!campaign.subject || !campaign.html || !campaign.from_email) {
    await setCampaign(campaign.id, { status: 'paused', last_error: 'Campaign needs a subject, content and From address' });
    return false;
  }

  const planLimits = PLAN_LIMITS[(tenant.plan ?? 'free') as PlanName] ?? PLAN_LIMITS.free;
  // Use up the remaining monthly quota exactly, then pause on the next chunk.
  const quotaLeft = (tenant.monthlyEmailLimit ?? 0) - (tenant.monthlyEmailCount ?? 0);
  if (quotaLeft <= 0) {
    await setCampaign(campaign.id, { status: 'paused', last_error: 'Monthly email limit reached. Upgrade your plan or wait for next month, then resume.' });
    return false;
  }
  const chunkSize = Math.min(
    MAX_CHUNK,
    quotaLeft,
    resolvePlanLimit(tenant.max_recipients_per_send, planLimits.max_recipients_per_send) ?? MAX_CHUNK,
  );

  const { data: pending } = await supabaseAdmin
    .from('campaign_contacts')
    .select('id, email')
    .eq('campaign_id', campaign.id)
    .is('processed_at', null)
    .order('created_at', { ascending: true })
    .limit(chunkSize);

  if (!pending || pending.length === 0) {
    await setCampaign(campaign.id, { status: 'completed', completed_at: new Date().toISOString(), last_error: null });
    console.log(`[campaign-scheduler] Campaign ${campaign.id} completed`);
    return false;
  }

  const { response, result } = captureResponse();
  await handleSend(
    {
      tenant,
      body: {
        subject: campaign.subject,
        html: campaign.html,
        from: campaign.from_email,
        toEmails: pending.map((row) => row.email),
        campaignId: campaign.id,
        emailType: 'marketing',
      },
    },
    response,
  );
  const { status, body } = result();
  const ids = pending.map((row) => row.id);

  if (status === 202 || status === 207 || status === 502) {
    // Jobs exist (queued, or recorded as failed): never resend these recipients.
    const jobIds: string[] = body.jobIds ?? [];
    const sentEmails = new Set<string>();
    for (let i = 0; i < jobIds.length; i += 150) {
      const { data } = await supabaseAdmin.from('email_jobs').select('to_email').in('job_id', jobIds.slice(i, i + 150));
      (data ?? []).forEach((row) => sentEmails.add(row.to_email));
    }
    const sent = pending.filter((row) => sentEmails.has(row.email)).map((row) => row.id);
    const skipped = pending.filter((row) => !sentEmails.has(row.email)).map((row) => row.id);
    await markProcessed(sent, null);
    await markProcessed(skipped, 'suppressed_or_unsubscribed');
    if (status === 502) {
      await setCampaign(campaign.id, { last_error: 'Some emails could not be queued; see mail history' });
    }
    return true;
  }

  if (status === 422 || (status === 400 && body.error === 'No recipients resolved')) {
    await markProcessed(ids, 'suppressed_or_unsubscribed');
    return true;
  }

  if (status === 402) {
    await setCampaign(campaign.id, { status: 'paused', last_error: 'Monthly email limit reached. Upgrade your plan or wait for next month, then resume.' });
    return false;
  }

  if (status === 403 || status === 404 || status === 400) {
    await setCampaign(campaign.id, { status: 'failed', last_error: body.error ?? `Send refused (${status})` });
    return false;
  }

  // 5xx before jobs were created: leave recipients pending and retry next tick.
  await setCampaign(campaign.id, { last_error: body.error ?? `Temporary error (${status}); retrying` });
  return false;
}

let ticking = false;

export async function runSchedulerTick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const now = new Date().toISOString();

    // Claim due campaigns. The status filter makes this safe if two ticks race.
    const { data: started } = await supabaseAdmin
      .from('campaigns')
      .update({ status: 'running', started_at: now, updated_at: now, last_error: null })
      .eq('status', 'scheduled')
      .lte('scheduled_at', now)
      .select('id');
    for (const row of started ?? []) {
      console.log(`[campaign-scheduler] Started scheduled campaign ${row.id}`);
    }

    const { data: running, error } = await supabaseAdmin
      .from('campaigns')
      .select('id, tenant_id, subject, html, from_email')
      .eq('status', 'running');

    if (error) {
      console.error('[campaign-scheduler] Failed to load running campaigns:', error.message);
      return;
    }

    for (const campaign of (running ?? []) as CampaignRow[]) {
      for (let i = 0; i < MAX_CHUNKS_PER_TICK; i++) {
        try {
          if (!(await sendChunk(campaign))) break;
        } catch (err) {
          console.error(`[campaign-scheduler] Chunk failed for ${campaign.id}:`, err);
          break;
        }
      }
    }
  } finally {
    ticking = false;
  }
}

export function startCampaignScheduler(): void {
  void runSchedulerTick();
  setInterval(() => void runSchedulerTick(), TICK_INTERVAL_MS);
  console.log('[campaign-scheduler] Started — checking every 15 seconds.');
}
