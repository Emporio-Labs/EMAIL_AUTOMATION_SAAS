import type { NextFunction, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';

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
    .select('id, name, slug')
    .eq('id', membership.tenant_id)
    .maybeSingle();

  if (tenantError || !tenant) {
    console.error('[requireTenant] tenants error:', tenantError);
    response.status(500).json({ error: 'Tenant not found', detail: tenantError?.message, hint: tenantError?.hint, code: tenantError?.code });
    return;
  }

  request.tenant = {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    role: membership.role,
  };

  next();
}