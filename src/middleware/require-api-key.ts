import type { NextFunction, Request, Response } from 'express';
import crypto from 'crypto';
import { supabaseAdmin } from '../lib/supabase';
import { processTenantLimits } from '../utils/tenant-limits';

function getApiKeyFromHeader(request: Request): string | null {
  const header = request.headers['x-api-key'];

  if (Array.isArray(header)) {
    const value = header.find((item) => item.trim().length > 0);
    return value ? value.trim() : null;
  }

  if (typeof header !== 'string') {
    return null;
  }

  const value = header.trim();
  return value.length > 0 ? value : null;
}

export async function requireApiKey(request: Request, response: Response, next: NextFunction): Promise<void> {
  const rawKey = getApiKeyFromHeader(request);

  if (!rawKey) {
    response.status(401).json({ error: 'Missing API key' });
    return;
  }

  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

  const { data, error } = await supabaseAdmin
    .from('api_keys')
    .select('id, tenant_id, name, key_preview, type, tenants!inner(id, name, slug, plan, rate_limit, monthly_email_limit, monthly_email_count, last_billing_reset, is_suspended, max_domains, max_sending_addresses, max_recipients_per_send, can_send_marketing, can_use_webhooks, can_track_opens, can_track_clicks, force_sandbox, trial_ends_at, internal_notes)')
    .eq('key_hash', keyHash)
    .is('revoked_at', null)
    .maybeSingle();

  if (error) {
    console.error('[requireApiKey] api_keys lookup error:', error);
    response.status(500).json({ error: 'Failed to validate API key' });
    return;
  }

  if (!data || !data.tenants) {
    response.status(401).json({ error: 'Invalid API key' });
    return;
  }

  const tenant = Array.isArray(data.tenants) ? data.tenants[0] : data.tenants;

  const limitData = await processTenantLimits(tenant as any);

  if (limitData.isSuspended) {
    response.status(403).json({ error: 'Account suspended. Please contact support.' });
    return;
  }

  request.apiKey = {
    id: data.id,
    tenantId: data.tenant_id,
    name: data.name,
    type: data.type as 'sandbox' | 'production',
    keyPreview: data.key_preview,
  };

  request.keyType = data.type as 'sandbox' | 'production';

  request.tenant = {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    role: 'api_key',
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
  };

  const { error: updateError } = await supabaseAdmin
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id);

  if (updateError) {
    console.warn('[requireApiKey] last_used_at update error:', updateError);
  }

  next();
}
