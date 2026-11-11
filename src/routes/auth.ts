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

const signupSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  tenantName: z.string().trim().min(2).max(80),
});

const acceptTermsSchema = z.object({
  version: z.string().min(1),
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

authRouter.post('/signup', async (request, response) => {
  const parsed = signupSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
    return;
  }

  const { email, password, tenantName } = parsed.data;

  // Verify that the email is whitelisted as a beta user
  const { data: betaUser, error: betaError } = await supabaseAdmin
    .from('beta_users')
    .select('email')
    .eq('email', email.toLowerCase())
    .maybeSingle();

  if (betaError || !betaUser) {
    response.status(403).json({
      error: 'Signups are currently restricted to beta users. Please request beta access.'
    });
    return;
  }

  // Create the auth user already confirmed. Beta users received their invite at
  // this address, so a second "confirm your email" mail adds nothing, and skipping
  // it keeps signup off Supabase's rate-limited built-in mailer.
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (authError || !authData.user) {
    const alreadyExists = authError?.code === 'email_exists' || /already (been )?registered/i.test(authError?.message ?? '');
    response.status(alreadyExists ? 409 : 400).json({
      error: alreadyExists
        ? 'An account with this email already exists. Please sign in instead.'
        : authError?.message ?? 'Failed to create account',
    });
    return;
  }

  const user = authData.user;

  // Derive a unique slug
  const tenantSlug = `${tenantName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${randomUUID().slice(0, 8)}`;

  const { data: tenant, error: tenantError } = await supabaseAdmin
    .from('tenants')
    .insert({ name: tenantName, slug: tenantSlug, owner_user_id: user.id })
    .select('id, name, slug')
    .single();

  if (tenantError || !tenant) {
    console.error('[signup] tenant insert error:', tenantError);
    response.status(500).json({ error: 'Account created but failed to set up workspace', detail: tenantError?.message, hint: tenantError?.hint, code: tenantError?.code });
    return;
  }

  const { error: memberError } = await supabaseAdmin.from('tenant_members').insert({
    tenant_id: tenant.id,
    user_id: user.id,
    role: 'owner',
  });

  if (memberError) {
    console.error('[signup] tenant_members insert error:', memberError);
    response.status(500).json({ error: 'Account created but failed to assign membership', detail: memberError?.message, hint: memberError?.hint, code: memberError?.code });
    return;
  }

  // Sign the new user in so the dashboard can continue straight to onboarding.
  const { data: sessionData, error: sessionError } = await supabasePublic.auth.signInWithPassword({ email, password });

  if (sessionError || !sessionData.session) {
    console.error('[signup] post-signup sign-in error:', sessionError);
    response.status(201).json({
      requiresConfirmation: true,
      message: 'Account created! Please sign in with your email and password.',
    });
    return;
  }

  response.status(201).json({
    access_token: sessionData.session.access_token,
    refresh_token: sessionData.session.refresh_token,
    expires_in: sessionData.session.expires_in,
    token_type: sessionData.session.token_type,
    user: sessionData.user,
  });
});

authRouter.get('/me', requireAuth, requireTenant, async (request, response) => {
  const { data: adminRow } = await supabaseAdmin
    .from('system_admins')
    .select('user_id')
    .eq('user_id', request.authUser!.id)
    .maybeSingle();

  response.json({
    user: request.authUser,
    tenant: request.tenant,
    isAdmin: Boolean(adminRow),
    termsAccepted: request.tenant?.beta_terms_accepted_at !== null && request.tenant?.beta_terms_accepted_at !== undefined,
    termsVersion: request.tenant?.accepted_terms_version ?? null,
  });
});

authRouter.post('/accept-terms', requireAuth, requireTenant, async (request, response) => {
  const parsed = acceptTermsSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
    return;
  }

  const { version } = parsed.data;
  const tenantId = request.tenant!.id;

  const now = new Date().toISOString();
  const { error: updateError } = await supabaseAdmin
    .from('tenants')
    .update({
      beta_terms_accepted_at: now,
      privacy_policy_accepted_at: now,
      accepted_terms_version: version,
    })
    .eq('id', tenantId);

  if (updateError) {
    console.error('[accept-terms] update error:', updateError);
    response.status(500).json({ error: 'Failed to accept terms', detail: updateError.message });
    return;
  }

  response.json({ success: true });
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