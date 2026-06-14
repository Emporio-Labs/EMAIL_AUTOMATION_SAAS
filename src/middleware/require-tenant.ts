import type { NextFunction, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { processTenantLimits } from '../utils/tenant-limits';

export async function requireTenant(request: Request, response: Response, next: NextFunction): Promise<void> {
  const userId = request.authUser?.id;

  if (!userId) {
    response.status(401).json({ error: 'Authentication required' });
    return;
  }

  const { data: membership, error: membershipError } = await supabaseAdmin
    .from('tenant_members')
    .select('tenant_id, role')
    .eq('user_id', userId)
    .maybeSingle();

  if (membershipError) {
    console.error('[requireTenant] tenant_members error:', membershipError);
    response.status(500).json({ error: 'Failed to resolve tenant context', detail: membershipError.message, hint: membershipError.hint, code: membershipError.code });
    return;
  }

  if (!membership) {
    response.status(403).json({ error: 'Tenant membership not found' });
    return;
  }

  const { data: tenant, error: tenantError } = await supabaseAdmin
    .from('tenants')
    .select('id, name, slug, plan, rate_limit, monthly_email_limit, monthly_email_count, last_billing_reset, is_suspended, max_domains, max_sending_addresses, max_recipients_per_send, can_send_marketing, can_use_webhooks, can_track_opens, can_track_clicks, force_sandbox, trial_ends_at, internal_notes, beta_terms_accepted_at, accepted_terms_version')
    .eq('id', membership.tenant_id)
    .maybeSingle();

  if (tenantError || !tenant) {
    console.error('[requireTenant] tenants error:', tenantError);
    response.status(500).json({ error: 'Tenant not found', detail: tenantError?.message, hint: tenantError?.hint, code: tenantError?.code });
    return;
  }

  const limitData = await processTenantLimits(tenant as any);

  if (limitData.isSuspended) {
    response.status(403).json({ error: 'Account suspended. Please contact support.' });
    return;
  }

  request.tenant = {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    role: membership.role,
    plan: limitData.plan,
    rateLimit: limitData.rateLimit,
    monthlyEmailLimit: limitData.monthlyEmailLimit,
    monthlyEmailCount: limitData.monthlyEmailCount,
    isSuspended: limitData.isSuspended,
    max_domains: limitData.max_domains,
    max_sending_addresses: limitData.max_sending_addresses,
    max_recipients_per_send: limitData.max_recipients_per_send,
    can_send_marketing: limitData.can_send_marketing,
    can_use_webhooks: limitData.can_use_webhooks,
    can_track_opens: limitData.can_track_opens,
    can_track_clicks: limitData.can_track_clicks,
    force_sandbox: limitData.force_sandbox,
    trial_ends_at: limitData.trial_ends_at,
    internal_notes: limitData.internal_notes,
    beta_terms_accepted_at: tenant.beta_terms_accepted_at,
    accepted_terms_version: tenant.accepted_terms_version,
  };

  next();
}