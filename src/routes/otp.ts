import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { isIP } from 'net';
import { env } from '../config/env';
import { requireApiKey } from '../middleware/require-api-key';
import { requireAuth } from '../middleware/require-auth';
import { requireTenant } from '../middleware/require-tenant';
import { supabaseAdmin } from '../lib/supabase';
import { buildEmailJobMessage, publishEmailJobMessage } from '../lib/sqs';
import {
  OTP_LIMITS,
  defaultOtpSender,
  generateOtpCode,
  hashOtpCode,
  normalizeOtpInput,
  renderOtpEmail,
  toSubdomainLabel,
  validateSubdomainLabel,
  verifyCaptcha,
  type CaptchaProvider,
} from '../lib/otp';
import { provisionOtpSubdomain, releaseOtpSubdomain, type SubdomainStatus } from '../lib/otp-domains';
import { normalizeEmail } from '../utils/normalize-email';
import { computeHtmlHash } from '../utils/hash';
import { checkSender, tenantContext } from './emails';

// Email OTP API.
//   POST /v1/otp/send       email a one-time code          (API key)
//   POST /v1/otp/verify     check a code, single use       (API key)
//   GET  /v1/otp/settings   sender, code policy, CAPTCHA   (dashboard)
//   PUT  /v1/otp/settings
// Codes are stored only as HMACs. OTP mail goes to its own SQS queue, gets no
// tracking or unsubscribe footer, and never stores the code in email_jobs.

export const otpRouter = Router();
export const otpSettingsRouter = Router();

type OtpSettings = {
  tenant_id: string;
  from_email: string | null;
  from_name: string | null;
  app_name: string | null;
  subdomain_label: string | null;
  subdomain_status: SubdomainStatus;
  subdomain_dkim_tokens: string[] | null;
  code_length: number;
  ttl_seconds: number;
  max_attempts: number;
  captcha_provider: CaptchaProvider | null;
  captcha_secret: string | null;
  require_captcha: boolean;
  paused_at: string | null;
  paused_reason: string | null;
};

const SETTINGS_COLUMNS = 'tenant_id, from_email, from_name, app_name, subdomain_label, subdomain_status, subdomain_dkim_tokens, code_length, ttl_seconds, max_attempts, captcha_provider, captcha_secret, require_captcha, paused_at, paused_reason';

// ── Settings and sender ───────────────────────────────────────────────────────

/** Reserves a default subdomain label from the tenant's slug, adding a suffix on collision. */
async function claimSubdomainLabel(tenantId: string, base: string): Promise<string | null> {
  const root = toSubdomainLabel(base) ?? 'app';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = attempt === 0 && !validateSubdomainLabel(root) ? root : `${root.slice(0, 35)}-${randomUUID().slice(0, 4)}`;
    const { data, error } = await supabaseAdmin
      .from('otp_settings')
      .update({ subdomain_label: candidate, subdomain_status: 'pending', updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .is('subdomain_label', null)
      .select('subdomain_label');
    // No row updated: a parallel request claimed a label first.
    if (!error) return data?.length ? candidate : null;
    if (error.code !== '23505') throw error;
  }
  return null;
}

async function setUpSubdomain(tenantId: string, label: string): Promise<SubdomainStatus> {
  try {
    const result = await provisionOtpSubdomain(label);
    await supabaseAdmin
      .from('otp_settings')
      .update({ subdomain_status: result.status, subdomain_dkim_tokens: result.dkimTokens, updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId);
    return result.status;
  } catch (error) {
    console.error(`[otp] Failed to provision ${label}:`, error instanceof Error ? error.message : error);
    await supabaseAdmin.from('otp_settings').update({ subdomain_status: 'failed' }).eq('tenant_id', tenantId);
    return 'failed';
  }
}

async function loadSettings(tenant: { id: string; slug?: string | null; name: string }): Promise<OtpSettings> {
  const { data, error } = await supabaseAdmin.from('otp_settings').select(SETTINGS_COLUMNS).eq('tenant_id', tenant.id).maybeSingle();
  if (error) throw new Error('Failed to load OTP settings');

  let settings = data as OtpSettings | null;
  if (!settings) {
    const inserted = await supabaseAdmin
      .from('otp_settings')
      .upsert({ tenant_id: tenant.id, app_name: tenant.name }, { onConflict: 'tenant_id', ignoreDuplicates: true });
    if (inserted.error) throw new Error('Failed to create OTP settings');
    const reread = await supabaseAdmin.from('otp_settings').select(SETTINGS_COLUMNS).eq('tenant_id', tenant.id).single();
    if (reread.error) throw new Error('Failed to load OTP settings');
    settings = reread.data as OtpSettings;
  }

  // First use with the platform OTP domain configured: give the tenant a default sender.
  if (env.OTP_SENDING_DOMAIN && !settings.from_email && !settings.subdomain_label) {
    const label = await claimSubdomainLabel(tenant.id, tenant.slug || tenant.name);
    if (label) {
      settings.subdomain_label = label;
      settings.subdomain_status = await setUpSubdomain(tenant.id, label);
    }
  }
  return settings;
}

type SenderResult = { ok: true; email: string; name: string | undefined } | { ok: false; status: number; error: string };

async function resolveSender(tenantId: string, settings: OtpSettings): Promise<SenderResult> {
  const name = settings.from_name ?? settings.app_name ?? undefined;
  if (settings.from_email) {
    const senderError = await checkSender(tenantId, settings.from_email);
    return senderError ? { ok: false, status: 409, error: `OTP sender: ${senderError}` } : { ok: true, email: settings.from_email, name };
  }

  const fallback = settings.subdomain_label ? defaultOtpSender(settings.subdomain_label) : null;
  if (!fallback) {
    return { ok: false, status: 409, error: 'No OTP sender is set up. Set from_email in OTP settings to an address on your verified domain.' };
  }
  if (settings.subdomain_status === 'pending') {
    return { ok: false, status: 409, error: `Your OTP sender ${fallback} is still being set up. Try again in a few minutes.` };
  }
  if (settings.subdomain_status !== 'verified') {
    return { ok: false, status: 409, error: `Your OTP sender ${fallback} could not be set up. Contact support or set from_email.` };
  }
  return { ok: true, email: fallback, name };
}

// ── POST /v1/otp/send ─────────────────────────────────────────────────────────

const sendSchema = z.object({
  email: z.string().trim().email(),
  // The end user's IP, as seen by the caller's server. Enables per-IP limits.
  ip: z.string().trim().refine((v) => isIP(v) !== 0, 'ip must be an IPv4 or IPv6 address').optional(),
  captcha_token: z.string().trim().min(1).max(4096).optional(),
  purpose: z.string().trim().min(1).max(50).optional(),
  app_name: z.string().trim().min(1).max(60).optional(),
});

function tooMany(response: Response, error: string, retryAfterSeconds: number) {
  response.setHeader('Retry-After', String(retryAfterSeconds));
  response.status(429).json({ error, retry_after_seconds: retryAfterSeconds });
}

otpRouter.post('/send', requireApiKey, async (request: Request, response: Response) => {
  const parsed = sendSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
    return;
  }
  const input = parsed.data;
  const ctx = tenantContext(request);
  const email = normalizeEmail(input.email);

  let settings: OtpSettings;
  try {
    settings = await loadSettings(request.tenant!);
  } catch (error) {
    response.status(500).json({ error: (error as Error).message });
    return;
  }

  if (settings.paused_at) {
    response.status(403).json({
      error: 'OTP sending is paused for this account because too many codes bounced or were marked as spam. Contact support.',
      reason: settings.paused_reason,
    });
    return;
  }

  // ── CAPTCHA ────────────────────────────────────────────────────────────────
  if (settings.require_captcha || (input.captcha_token && settings.captcha_provider)) {
    if (!input.captcha_token) {
      response.status(400).json({ error: 'captcha_token is required for this account' });
      return;
    }
    if (!settings.captcha_provider || !settings.captcha_secret) {
      response.status(500).json({ error: 'CAPTCHA is required but not configured. Add a provider and secret in OTP settings.' });
      return;
    }
    if (!(await verifyCaptcha(settings.captcha_provider, settings.captcha_secret, input.captcha_token, input.ip))) {
      response.status(403).json({ error: 'CAPTCHA check failed' });
      return;
    }
  }

  // ── Suppression and rate limits ───────────────────────────────────────────
  const { data: suppressedRow } = await supabaseAdmin
    .from('suppressed')
    .select('email')
    .eq('email', email)
    .or(`tenant_id.eq.${ctx.id},tenant_id.is.null`)
    .limit(1)
    .maybeSingle();
  if (suppressedRow) {
    response.status(422).json({ error: 'This address previously bounced or marked mail as spam, so no code was sent.' });
    return;
  }

  const { data: counts, error: countsError } = await supabaseAdmin.rpc('otp_rate_counts', {
    p_tenant_id: ctx.id,
    p_email: email,
    p_client_ip: input.ip ?? null,
  });
  if (countsError) {
    console.error('[otp] rate count failed:', countsError);
    response.status(500).json({ error: 'Failed to check rate limits' });
    return;
  }
  const c = (Array.isArray(counts) ? counts[0] : counts) as Record<string, number>;
  if (c.email_last_minute >= OTP_LIMITS.perEmailPerMinute) {
    tooMany(response, 'A code was just sent to this address. Wait a minute before asking for another.', 60);
    return;
  }
  if (c.email_last_hour >= OTP_LIMITS.perEmailPerHour) {
    tooMany(response, `At most ${OTP_LIMITS.perEmailPerHour} codes per address per hour.`, 3600);
    return;
  }
  if (input.ip && c.ip_last_hour >= OTP_LIMITS.perIpPerHour) {
    tooMany(response, `At most ${OTP_LIMITS.perIpPerHour} codes per IP address per hour.`, 3600);
    return;
  }
  const tenantPerMinute = ctx.rateLimit && ctx.rateLimit > 0 ? ctx.rateLimit : OTP_LIMITS.perTenantPerMinuteDefault;
  if (c.tenant_last_minute >= tenantPerMinute) {
    tooMany(response, `Your account allows ${tenantPerMinute} codes per minute.`, 60);
    return;
  }

  // ── Sender ─────────────────────────────────────────────────────────────────
  const sender = await resolveSender(ctx.id, settings);
  if (!sender.ok) {
    response.status(sender.status).json({ error: sender.error });
    return;
  }

  const codeId = randomUUID();
  const code = generateOtpCode(settings.code_length);
  const expiresAt = new Date(Date.now() + settings.ttl_seconds * 1000).toISOString();
  const appName = input.app_name ?? settings.app_name ?? ctx.name;
  const codeRow = {
    id: codeId,
    tenant_id: ctx.id,
    email,
    purpose: input.purpose ?? null,
    code_hash: hashOtpCode(codeId, code),
    client_ip: input.ip ?? null,
    max_attempts: settings.max_attempts,
    expires_at: expiresAt,
  };

  // A new code replaces any earlier one for the same address.
  const supersede = () =>
    supabaseAdmin
      .from('otp_codes')
      .update({ status: 'superseded', consumed_at: new Date().toISOString() })
      .eq('tenant_id', ctx.id)
      .eq('email', email)
      .eq('status', 'pending');

  // Sandbox keys send nothing and return the code, for integration tests.
  if (ctx.isSandbox) {
    await supersede();
    const { error } = await supabaseAdmin.from('otp_codes').insert(codeRow);
    if (error) {
      response.status(500).json({ error: 'Failed to create code' });
      return;
    }
    response.status(202).json({ id: codeId, email, expires_at: expiresAt, sandbox: true, code });
    return;
  }

  if (!env.AUTH_BYPASS) {
    const { data: reserved, error: reserveError } = await supabaseAdmin.rpc('reserve_tenant_email_quota', { p_tenant_id: ctx.id, p_count: 1 });
    if (reserveError) {
      response.status(500).json({ error: 'Failed to reserve monthly quota' });
      return;
    }
    if (reserved === null) {
      response.status(402).json({ error: 'Monthly email sending limit exceeded', hint: `Your limit is ${ctx.monthlyLimit} emails.` });
      return;
    }
  }
  const releaseQuota = async () => {
    if (env.AUTH_BYPASS) return;
    await supabaseAdmin.rpc('release_tenant_email_quota', { p_tenant_id: ctx.id, p_count: 1 });
  };

  const message = renderOtpEmail({ code, appName, ttlMinutes: Math.round(settings.ttl_seconds / 60) });
  // The job log never holds the code: the stored subject and body are redacted.
  const redactedSubject = message.subject.replace(code, '•'.repeat(code.length));
  const storedContent = `[OTP email to ${email}; content not stored]`;
  const htmlHash = computeHtmlHash(storedContent);
  const jobId = randomUUID();

  const { error: htmlError } = await supabaseAdmin
    .from('email_html_contents')
    .upsert({ hash: htmlHash, html: storedContent }, { onConflict: 'hash' });
  const { error: jobError } = htmlError
    ? { error: htmlError }
    : await supabaseAdmin.from('email_jobs').insert({
        job_id: jobId,
        tenant_id: ctx.id,
        from_email: sender.email,
        to_email: email,
        to_emails: [email],
        subject: redactedSubject,
        html_hash: htmlHash,
        status: 'queued',
        email_type: 'transactional',
        source: 'otp',
        tags: input.purpose ? { purpose: input.purpose } : null,
      });
  if (jobError) {
    await releaseQuota();
    console.error('[otp] Failed to create job:', jobError);
    response.status(500).json({ error: 'Failed to create email' });
    return;
  }

  await supersede();
  const { error: codeError } = await supabaseAdmin.from('otp_codes').insert({ ...codeRow, job_id: jobId });
  if (codeError) {
    await releaseQuota();
    await supabaseAdmin.from('email_jobs').update({ status: 'failed', failed_at: new Date().toISOString(), failure_reason: 'Failed to store code' }).eq('job_id', jobId);
    response.status(500).json({ error: 'Failed to create code' });
    return;
  }

  try {
    const sqsMessageId = await publishEmailJobMessage(
      buildEmailJobMessage({
        jobId,
        tenantId: ctx.id,
        from: sender.email,
        fromName: sender.name,
        to: email,
        subject: message.subject,
        html: message.html,
        text: message.text,
        configurationSetName: env.SES_CONFIGURATION_SET,
      }),
      env.OTP_SQS_QUEUE_URL ?? env.SQS_QUEUE_URL,
    );
    await supabaseAdmin.from('email_jobs').update({ sqs_message_id: sqsMessageId }).eq('job_id', jobId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Failed to queue email';
    await Promise.all([
      supabaseAdmin.from('email_jobs').update({ status: 'failed', failed_at: new Date().toISOString(), failure_reason: reason }).eq('job_id', jobId),
      supabaseAdmin.from('otp_codes').delete().eq('id', codeId),
      releaseQuota(),
    ]);
    response.status(502).json({ error: 'Failed to queue email' });
    return;
  }

  response.status(202).json({ id: codeId, email_id: jobId, email, from: sender.email, expires_at: expiresAt });
});

// ── POST /v1/otp/verify ───────────────────────────────────────────────────────

const verifySchema = z.object({
  email: z.string().trim().email(),
  code: z.string().trim().min(1).max(20),
  // The id returned by /send. Without it, the newest code for the address is checked.
  id: z.string().uuid().optional(),
});

otpRouter.post('/verify', requireApiKey, async (request: Request, response: Response) => {
  const parsed = verifySchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
    return;
  }
  const tenantId = request.tenant!.id;
  const email = normalizeEmail(parsed.data.email);
  const code = normalizeOtpInput(parsed.data.code);

  let lookup = supabaseAdmin.from('otp_codes').select('id').eq('tenant_id', tenantId).eq('email', email);
  lookup = parsed.data.id ? lookup.eq('id', parsed.data.id) : lookup.order('created_at', { ascending: false }).limit(1);
  const { data: row, error: lookupError } = await lookup.maybeSingle();
  if (lookupError) {
    response.status(500).json({ error: 'Failed to load code' });
    return;
  }
  if (!row) {
    response.json({ valid: false, reason: 'not_found', attempts_remaining: 0 });
    return;
  }

  const { data, error } = await supabaseAdmin.rpc('otp_verify_attempt', {
    p_tenant_id: tenantId,
    p_email: email,
    p_code_id: row.id,
    p_candidate_hash: hashOtpCode(row.id, code),
  });
  if (error) {
    console.error('[otp] verify failed:', error);
    response.status(500).json({ error: 'Failed to verify code' });
    return;
  }

  const result = (Array.isArray(data) ? data[0] : data) as { result: string; code_id: string | null; attempts_remaining: number };
  if (result.result === 'verified') {
    response.json({ valid: true, id: result.code_id, email });
    return;
  }
  response.json({ valid: false, id: result.code_id, reason: result.result, attempts_remaining: result.attempts_remaining });
});

// ── Settings (dashboard) ──────────────────────────────────────────────────────

function publicSettings(s: OtpSettings) {
  const defaultSender = s.subdomain_label ? defaultOtpSender(s.subdomain_label) : null;
  return {
    from_email: s.from_email,
    from_name: s.from_name,
    app_name: s.app_name,
    sender: s.from_email ?? defaultSender,
    default_sender: defaultSender,
    default_sender_status: s.subdomain_status,
    subdomain_label: s.subdomain_label,
    code_length: s.code_length,
    ttl_seconds: s.ttl_seconds,
    max_attempts: s.max_attempts,
    captcha_provider: s.captcha_provider,
    has_captcha_secret: Boolean(s.captcha_secret),
    require_captcha: s.require_captcha,
    paused: Boolean(s.paused_at),
    paused_at: s.paused_at,
    paused_reason: s.paused_reason,
    limits: OTP_LIMITS,
  };
}

const settingsSchema = z.object({
  from_email: z.string().trim().toLowerCase().email().nullable().optional(),
  from_name: z.string().trim().min(1).max(100).nullable().optional(),
  app_name: z.string().trim().min(1).max(60).nullable().optional(),
  subdomain_label: z.string().trim().toLowerCase().optional(),
  code_length: z.number().int().min(4).max(8).optional(),
  ttl_seconds: z.number().int().min(120).max(900).optional(),
  max_attempts: z.number().int().min(1).max(10).optional(),
  captcha_provider: z.enum(['turnstile', 'hcaptcha']).nullable().optional(),
  captcha_secret: z.string().trim().min(1).max(500).nullable().optional(),
  require_captcha: z.boolean().optional(),
});

otpSettingsRouter.use(requireAuth, requireTenant);

otpSettingsRouter.get('/', async (request, response) => {
  try {
    const settings = await loadSettings(request.tenant!);
    const { data: alerts } = await supabaseAdmin
      .from('otp_alerts')
      .select('level, sent_count, bounce_rate, complaint_rate, created_at')
      .eq('tenant_id', settings.tenant_id)
      .order('created_at', { ascending: false })
      .limit(10);
    response.json({ settings: publicSettings(settings), alerts: alerts ?? [] });
  } catch (error) {
    response.status(500).json({ error: (error as Error).message });
  }
});

otpSettingsRouter.put('/', async (request, response) => {
  const parsed = settingsSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
    return;
  }
  const tenantId = request.tenant!.id;
  const { subdomain_label: newLabel, ...changes } = parsed.data;

  let current: OtpSettings;
  try {
    current = await loadSettings(request.tenant!);
  } catch (error) {
    response.status(500).json({ error: (error as Error).message });
    return;
  }

  if (changes.from_email) {
    const senderError = await checkSender(tenantId, changes.from_email);
    if (senderError) {
      response.status(400).json({ error: senderError });
      return;
    }
  }

  const merged = { ...current, ...changes };
  if (merged.require_captcha && (!merged.captcha_provider || !merged.captcha_secret)) {
    response.status(400).json({ error: 'Set captcha_provider and captcha_secret before requiring CAPTCHA.' });
    return;
  }

  if (newLabel !== undefined && newLabel === current.subdomain_label && current.subdomain_status === 'failed') {
    // Saving the same label again retries a failed setup.
    await setUpSubdomain(tenantId, newLabel);
  } else if (newLabel !== undefined && newLabel !== current.subdomain_label) {
    if (!env.OTP_SENDING_DOMAIN) {
      response.status(400).json({ error: 'Default OTP subdomains are not enabled on this server.' });
      return;
    }
    const labelError = validateSubdomainLabel(newLabel);
    if (labelError) {
      response.status(400).json({ error: labelError });
      return;
    }
    const { error } = await supabaseAdmin
      .from('otp_settings')
      .update({ subdomain_label: newLabel, subdomain_status: 'pending', subdomain_dkim_tokens: null })
      .eq('tenant_id', tenantId);
    if (error) {
      response.status(error.code === '23505' ? 409 : 500).json({ error: error.code === '23505' ? 'That subdomain is taken.' : 'Failed to save subdomain' });
      return;
    }
    if (current.subdomain_label) {
      await releaseOtpSubdomain(current.subdomain_label, current.subdomain_dkim_tokens).catch((err) =>
        console.error('[otp] Failed to release old subdomain:', err instanceof Error ? err.message : err),
      );
    }
    await setUpSubdomain(tenantId, newLabel);
  }

  const { data, error } = await supabaseAdmin
    .from('otp_settings')
    .update({ ...changes, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .select(SETTINGS_COLUMNS)
    .single();
  if (error || !data) {
    response.status(500).json({ error: 'Failed to save OTP settings' });
    return;
  }
  response.json({ settings: publicSettings(data as OtpSettings) });
});
