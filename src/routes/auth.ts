import { randomUUID } from 'crypto';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/require-auth';
import { requireTenant } from '../middleware/require-tenant';
import { supabaseAdmin, supabasePublic } from '../lib/supabase';

export const authRouter = Router();

const onboardSchema = z.object({
  tenantName: z.string().trim().min(2).max(80),
  tenantSlug: z.string().trim().min(2).max(80).optional(),
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(6),
});

authRouter.post('/login', async (request, response) => {
  const parsed = loginSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
    return;
  }

  const { data, error } = await supabasePublic.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error || !data.session) {
    response.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  response.json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_in: data.session.expires_in,
    token_type: data.session.token_type,
    user: data.user,
  });
});

authRouter.get('/me', requireAuth, requireTenant, (request, response) => {
  response.json({
    user: request.authUser,
    tenant: request.tenant,
  });
});

authRouter.post('/onboard', requireAuth, async (request, response) => {
  const parsed = onboardSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
    return;
  }

  const user = request.authUser;

  if (!user) {
    response.status(401).json({ error: 'Authentication required' });
    return;
  }

  const { data: existingMembership, error: membershipError } = await supabaseAdmin
    .from('tenant_members')
    .select('tenant_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (membershipError) {
    response.status(500).json({ error: 'Failed to inspect tenant membership' });
    return;
  }

  if (existingMembership) {
    response.status(200).json({ ok: true, alreadyOnboarded: true });
    return;
  }

  const tenantSlug =
    parsed.data.tenantSlug ??
    `${parsed.data.tenantName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${randomUUID().slice(0, 8)}`;

  const { data: tenant, error: tenantError } = await supabaseAdmin
    .from('tenants')
    .insert({
      name: parsed.data.tenantName,
      slug: tenantSlug,
      owner_user_id: user.id,
    })
    .select('id, name, slug')
    .single();

  if (tenantError || !tenant) {
    response.status(500).json({ error: 'Failed to create tenant' });
    return;
  }

  const { error: memberInsertError } = await supabaseAdmin.from('tenant_members').insert({
    tenant_id: tenant.id,
    user_id: user.id,
    role: 'owner',
  });

  if (memberInsertError) {
    response.status(500).json({ error: 'Failed to create tenant membership' });
    return;
  }

  response.status(201).json({ tenant });
});