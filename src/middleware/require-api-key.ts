import type { NextFunction, Request, Response } from 'express';
import crypto from 'crypto';
import { supabaseAdmin } from '../lib/supabase';

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
    .select('id, tenant_id, name, key_preview, type, tenants!inner(id, name, slug)')
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
