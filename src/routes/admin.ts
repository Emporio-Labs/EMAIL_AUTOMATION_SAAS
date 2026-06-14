import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { requireAuth } from '../middleware/require-auth';
import { requireTenant } from '../middleware/require-tenant';
import { requireAdmin } from '../middleware/require-admin';
import { supabaseAdmin } from '../lib/supabase';
import { buildEmailJobMessage, publishEmailJobMessage } from '../lib/sqs';
import { env } from '../config/env';

export const adminRouter = Router();

// Apply auth middlewares to all admin routes
adminRouter.use(requireAuth);
adminRouter.use(requireTenant);
adminRouter.use(requireAdmin);

const tenantUpdateSchema = z.object({
  plan: z.enum(['free', 'beta', 'starter', 'growth', 'scale']).optional(),
  rate_limit: z.number().int().positive().optional(),
  monthly_email_limit: z.number().int().nonnegative().optional(),
  is_suspended: z.boolean().optional(),
  max_domains: z.number().int().nonnegative().nullable().optional(),
  max_sending_addresses: z.number().int().nonnegative().nullable().optional(),
  max_recipients_per_send: z.number().int().nonnegative().nullable().optional(),
  can_send_marketing: z.boolean().nullable().optional(),
  can_use_webhooks: z.boolean().nullable().optional(),
  can_track_opens: z.boolean().nullable().optional(),
  can_track_clicks: z.boolean().nullable().optional(),
  force_sandbox: z.boolean().nullable().optional(),
  trial_ends_at: z.string().nullable().optional(),
  internal_notes: z.string().nullable().optional(),
});

const betaUserSchema = z.object({
  email: z.string().trim().email(),
});

// GET /v1/admin/stats - Global statistics
adminRouter.get('/stats', async (request, response) => {
  try {
    // 1. Total Tenants
    const { count: tenantsCount, error: tenantsError } = await supabaseAdmin
      .from('tenants')
      .select('id', { count: 'exact', head: true });

    if (tenantsError) throw tenantsError;

    // 2. Total Whitelisted Beta Users
    const { count: betaCount, error: betaError } = await supabaseAdmin
      .from('beta_users')
      .select('email', { count: 'exact', head: true });

    if (betaError) throw betaError;

    // 3. Email jobs grouped by status
    const { data: jobGroups, error: jobsError } = await supabaseAdmin
      .from('email_jobs')
      .select('status');

    if (jobsError) throw jobsError;

    const stats = {
      queued: 0,
      delivered: 0,
      failed: 0,
      total: jobGroups?.length ?? 0,
    };

    jobGroups?.forEach((job) => {
      const status = job.status as 'queued' | 'delivered' | 'failed';
      if (stats[status] !== undefined) {
        stats[status]++;
      }
    });

    response.json({
      totalTenants: tenantsCount ?? 0,
      totalBetaUsers: betaCount ?? 0,
      emailStats: stats,
    });
  } catch (error: any) {
    console.error('[admin stats] Error:', error);
    response.status(500).json({ error: 'Failed to fetch global stats', detail: error.message });
  }
});

// GET /v1/admin/tenants - List all tenants
adminRouter.get('/tenants', async (request, response) => {
  try {
    const { data: tenants, error: tenantsError } = await supabaseAdmin
      .from('tenants')
      .select('id, name, slug, plan, rate_limit, monthly_email_limit, monthly_email_count, last_billing_reset, is_suspended, created_at, max_domains, max_sending_addresses, max_recipients_per_send, can_send_marketing, can_use_webhooks, can_track_opens, can_track_clicks, force_sandbox, trial_ends_at, internal_notes')
      .order('created_at', { ascending: false });

    if (tenantsError) throw tenantsError;

    response.json({ tenants });
  } catch (error: any) {
    console.error('[admin tenants] Error:', error);
    response.status(500).json({ error: 'Failed to list tenants', detail: error.message });
  }
});

// PATCH /v1/admin/tenants/:id - Update tenant settings
adminRouter.patch('/tenants/:id', async (request, response) => {
  const parsed = tenantUpdateSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
    return;
  }

  const tenantId = request.params.id;

  try {
    const { data: tenant, error: tenantError } = await supabaseAdmin
      .from('tenants')
      .update(parsed.data)
      .eq('id', tenantId)
      .select()
      .single();

    if (tenantError) throw tenantError;

    response.json({ tenant });
  } catch (error: any) {
    console.error('[admin update tenant] Error:', error);
    response.status(500).json({ error: 'Failed to update tenant settings', detail: error.message });
  }
});

// GET /v1/admin/beta-users - List beta users
adminRouter.get('/beta-users', async (request, response) => {
  try {
    const { data: betaUsers, error: betaError } = await supabaseAdmin
      .from('beta_users')
      .select('email, invited_at')
      .order('invited_at', { ascending: false });

    if (betaError) throw betaError;

    response.json({ betaUsers });
  } catch (error: any) {
    console.error('[admin beta list] Error:', error);
    response.status(500).json({ error: 'Failed to list beta users', detail: error.message });
  }
});

// POST /v1/admin/beta-users - Whitelist and send invite email (dogfooding)
adminRouter.post('/beta-users', async (request, response) => {
  const parsed = betaUserSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
    return;
  }

  const { email } = parsed.data;
  const adminTenantId = request.tenant?.id;

  try {
    // 1. Use platform default sender
    const fromEmail = env.PLATFORM_FROM_EMAIL;

    // 2. Add email to public.beta_users whitelist
    const { error: whitelistError } = await supabaseAdmin
      .from('beta_users')
      .insert({ email: email.toLowerCase() });

    if (whitelistError) {
      if (whitelistError.code === '23505') {
        response.status(409).json({ error: 'Email is already in the beta whitelist' });
        return;
      }
      throw whitelistError;
    }

    // 3. Queue the invitation email via SQS (dogfooding)
    const dashboardUrl = request.headers.origin || 'http://localhost:3001';
    const signupUrl = `${dashboardUrl}/signin?email=${encodeURIComponent(email)}&mode=signup`;

    const inviteHtml = `
      <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; border: 1px solid #eaeaea; border-radius: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
        <h2 style="color: #1a1a1a; font-size: 20px; font-weight: 700; margin-bottom: 16px;">You're Invited to SwayamMail!</h2>
        <p style="color: #4a4a4a; line-height: 1.6; font-size: 14px;">You have been granted exclusive beta access to SwayamMail — the India-first transactional email platform for builders.</p>
        <div style="margin: 32px 0;">
          <a href="${signupUrl}" style="background-color: #1a1a1a; color: white; padding: 12px 24px; text-decoration: none; border-radius: 9999px; font-size: 14px; font-weight: 600; display: inline-block; text-align: center;">Accept Invite & Create Account</a>
        </div>
        <p style="color: #71717a; font-size: 11px; margin-top: 32px;">This invitation was sent to ${email}. If you did not request this, please ignore this email.</p>
      </div>
    `;

    const { data: job, error: jobError } = await supabaseAdmin
      .from('email_jobs')
      .insert({
        tenant_id: adminTenantId,
        from_email: fromEmail,
        to_email: email,
        subject: "You've been invited to SwayamMail Beta",
        html: inviteHtml,
        status: 'queued',
        email_type: 'transactional',
      })
      .select('job_id')
      .single();

    if (jobError || !job) throw jobError;

    const messageBody = buildEmailJobMessage({
      jobId: job.job_id,
      tenantId: adminTenantId as string,
      from: fromEmail,
      to: email,
      subject: "You've been invited to SwayamMail Beta",
      html: inviteHtml,
      configurationSetName: env.SES_CONFIGURATION_SET,
      headers: [],
    });

    const messageId = await publishEmailJobMessage(messageBody);

    await supabaseAdmin
      .from('email_jobs')
      .update({ sqs_message_id: messageId })
      .eq('job_id', job.job_id);

    response.status(201).json({
      message: 'User added to whitelist and invitation email queued successfully',
      email,
      jobId: job.job_id,
      sqsMessageId: messageId,
    });
  } catch (error: any) {
    console.error('[admin add beta] Error:', error);
    response.status(500).json({ error: 'Failed to whitelist and invite beta user', detail: error.message });
  }
});

// DELETE /v1/admin/beta-users/:email - Remove user from whitelist
adminRouter.delete('/beta-users/:email', async (request, response) => {
  const email = request.params.email;

  try {
    const { error: deleteError } = await supabaseAdmin
      .from('beta_users')
      .delete()
      .eq('email', email.toLowerCase());

    if (deleteError) throw deleteError;

    response.json({ message: 'User removed from whitelist successfully', email });
  } catch (error: any) {
    console.error('[admin delete beta] Error:', error);
    response.status(500).json({ error: 'Failed to remove user from whitelist', detail: error.message });
  }
});
