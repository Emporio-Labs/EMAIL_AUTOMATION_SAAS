import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { createHash, randomUUID } from 'crypto';
import { env } from '../config/env';
import { requireApiKey } from '../middleware/require-api-key';
import { supabaseAdmin } from '../lib/supabase';
import { buildEmailJobMessage, publishEmailJobMessage } from '../lib/sqs';
import { escapeHtml, injectTrackingPixel } from '../lib/tracker';
import { normalizeEmail } from '../utils/normalize-email';
import { computeHtmlHash } from '../utils/hash';
import { tryConsume } from '../utils/rate-limiter';
import { PLAN_LIMITS, resolvePlanBooleanLimit, resolvePlanLimit, type PlanName } from '../config/plans';

// Transactional send API for external apps and dashboards.
//   POST /v1/emails         one email (to, cc, bcc may hold several addresses)
//   POST /v1/emails/batch   up to 100 independent emails
//   GET  /v1/emails/:id     status and event history of one email
// Mail sent here never gets an unsubscribe footer or click tracking.

export const emailsRouter = Router();

const MAX_RECIPIENTS = 50;
const MAX_BATCH = 100;
// SQS messages are capped at 256 KB, and the HTML travels inside one.
const MAX_HTML_BYTES = 200 * 1024;

const addressList = z
  .union([z.string(), z.array(z.string())])
  .transform((value) => (Array.isArray(value) ? value : [value]))
  .pipe(z.array(z.string().trim().email()).max(MAX_RECIPIENTS));

const emailSchema = z
  .object({
    from: z.string().trim().min(3),
    from_name: z.string().trim().max(100).optional(),
    to: addressList.pipe(z.array(z.string()).min(1, 'At least one "to" address is required')),
    cc: addressList.optional(),
    bcc: addressList.optional(),
    reply_to: addressList.optional(),
    subject: z.string().trim().min(1).max(200),
    html: z.string().trim().min(1).optional(),
    text: z.string().trim().min(1).optional(),
    attachments: z
      .array(
        z.object({
          filename: z.string().trim().min(1).max(200),
          url: z.string().trim().url().refine((u) => u.startsWith('https://'), 'Attachment URL must use https'),
        }),
      )
      .max(10)
      .optional(),
    tags: z.record(z.string().max(50), z.string().max(200)).optional(),
    track_opens: z.boolean().default(true),
  })
  .refine((v) => v.html || v.text, { message: 'Provide html or text', path: ['html'] })
  .refine((v) => !v.html || Buffer.byteLength(v.html, 'utf8') <= MAX_HTML_BYTES, {
    message: `html must be at most ${MAX_HTML_BYTES / 1024} KB. Link large content instead of inlining it.`,
    path: ['html'],
  })
  .refine((v) => !v.tags || Object.keys(v.tags).length <= 10, { message: 'At most 10 tags', path: ['tags'] });

type EmailInput = z.infer<typeof emailSchema>;

const batchSchema = z.object({ emails: z.array(z.unknown()).min(1).max(MAX_BATCH) });

const idempotencyKeySchema = z.string().trim().min(1).max(200);

type SendResult =
  | { ok: true; status: 200 | 202; body: Record<string, unknown> }
  | { ok: false; status: number; body: Record<string, unknown> };

type TenantContext = {
  id: string;
  name: string;
  isSandbox: boolean;
  plan: PlanName;
  maxRecipients: number | null;
  trackOpens: boolean;
  rateLimit: number | undefined;
  monthlyLimit: number;
  // Mutable so a batch counts its own earlier emails.
  monthlyCount: number;
};

export function tenantContext(request: Request): TenantContext {
  const tenant = request.tenant!;
  const trialEndsAt = tenant.trial_ends_at;
  const plan: PlanName = trialEndsAt && new Date() > new Date(trialEndsAt) ? 'free' : ((tenant.plan ?? 'free') as PlanName);
  const planLimits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;

  return {
    id: tenant.id,
    name: tenant.name,
    isSandbox: request.keyType === 'sandbox' || Boolean(tenant.force_sandbox),
    plan,
    maxRecipients: resolvePlanLimit(tenant.max_recipients_per_send, planLimits.max_recipients_per_send),
    trackOpens: resolvePlanBooleanLimit(tenant.can_track_opens, planLimits.can_track_opens),
    rateLimit: tenant.rateLimit,
    monthlyLimit: tenant.monthlyEmailLimit ?? 1000,
    monthlyCount: tenant.monthlyEmailCount ?? 0,
  };
}

/** Accepts "a@b.com" or "Name <a@b.com>". */
function parseFrom(raw: string, explicitName?: string): { email: string; name?: string } | null {
  const match = raw.match(/^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/);
  const email = normalizeEmail(match ? match[2] : raw);
  if (!z.string().email().safeParse(email).success) {
    return null;
  }
  const name = explicitName || match?.[1]?.trim() || undefined;
  return { email, name };
}

/** Gmail-style attachment chips, linking to the hosted files. */
export function renderAttachmentCards(attachments: Array<{ filename: string; url: string }>): string {
  const cards = attachments
    .map(({ filename, url }) => {
      const ext = (filename.split('.').pop() ?? '').slice(0, 4).toUpperCase() || 'FILE';
      const badgeColor = ext === 'PDF' ? '#d93025' : '#5f6368';
      return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" style="display:inline-block;margin:0 8px 8px 0;padding:8px 12px;border:1px solid #dadce0;border-radius:8px;text-decoration:none;color:#202124;font-family:Arial,Helvetica,sans-serif;font-size:13px;max-width:260px;">`
        + `<span style="display:inline-block;padding:2px 5px;margin-right:8px;border-radius:3px;background:${badgeColor};color:#ffffff;font-size:10px;font-weight:bold;vertical-align:middle;">${escapeHtml(ext)}</span>`
        + `<span style="vertical-align:middle;">${escapeHtml(filename)}</span></a>`;
    })
    .join('');

  return `<div style="margin-top:24px;padding-top:12px;border-top:1px solid #eeeeee;">`
    + `<div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#5f6368;margin-bottom:8px;">${attachments.length} attachment${attachments.length === 1 ? '' : 's'}</div>`
    + `${cards}</div>`;
}

function insertBeforeBodyEnd(html: string, fragment: string): string {
  const index = html.toLowerCase().lastIndexOf('</body>');
  return index === -1 ? html + fragment : html.slice(0, index) + fragment + html.slice(index);
}

function requestHash(input: EmailInput): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function publicEmail(row: Record<string, any>): Record<string, unknown> {
  return {
    id: row.job_id,
    status: row.status,
    from: row.from_email,
    to: row.to_emails ?? [row.to_email],
    cc: row.cc_emails ?? [],
    subject: row.subject,
    tags: row.tags ?? {},
    created_at: row.created_at,
  };
}

const EMAIL_COLUMNS = 'job_id, status, from_email, to_email, to_emails, cc_emails, bcc_emails, subject, tags, request_hash, created_at, sent_at, delivered_at, opened_at, open_count, failed_at, failure_reason, attachments';

async function findByIdempotencyKey(tenantId: string, key: string) {
  const { data } = await supabaseAdmin
    .from('email_jobs')
    .select(EMAIL_COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('idempotency_key', key)
    .maybeSingle();
  return data;
}

function replayOrConflict(existing: Record<string, any>, hash: string): SendResult {
  if (existing.request_hash !== hash) {
    return {
      ok: false,
      status: 409,
      body: { error: 'Idempotency-Key was already used with a different request body' },
    };
  }
  return { ok: true, status: 200, body: { ...publicEmail(existing), idempotent_replay: true } };
}

export async function checkSender(tenantId: string, fromEmail: string): Promise<string | null> {
  if (env.AUTH_BYPASS) {
    return null;
  }

  const domain = fromEmail.split('@')[1];
  const [domainCheck, addressCheck] = await Promise.all([
    supabaseAdmin.from('domains').select('verified').eq('tenant_id', tenantId).eq('domain', domain).maybeSingle(),
    supabaseAdmin.from('sending_addresses').select('id').eq('tenant_id', tenantId).eq('address', fromEmail).maybeSingle(),
  ]);

  if (domainCheck.error || addressCheck.error) {
    throw new Error('Failed to check sender');
  }
  if (!domainCheck.data) {
    return `Domain "${domain}" is not registered for this account. Add and verify it under Domains.`;
  }
  if (!domainCheck.data.verified) {
    return `Domain "${domain}" is not verified yet.`;
  }
  if (!addressCheck.data) {
    return `Address "${fromEmail}" is not registered. Add it under Sending addresses.`;
  }
  return null;
}

async function sendOne(ctx: TenantContext, raw: unknown, idempotencyKey: string | null): Promise<SendResult> {
  const parsed = emailSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, status: 400, body: { error: 'Invalid payload', issues: parsed.error.flatten() } };
  }
  const input = parsed.data;
  const hash = requestHash(input);

  if (idempotencyKey) {
    const existing = await findByIdempotencyKey(ctx.id, idempotencyKey);
    if (existing) {
      return replayOrConflict(existing, hash);
    }
  }

  const from = parseFrom(input.from, input.from_name);
  if (!from) {
    return { ok: false, status: 400, body: { error: '"from" must be an email address, optionally as "Name <email>"' } };
  }

  const unique = (list?: string[]) => Array.from(new Set((list ?? []).map(normalizeEmail)));
  const to = unique(input.to);
  const cc = unique(input.cc).filter((e) => !to.includes(e));
  const bcc = unique(input.bcc).filter((e) => !to.includes(e) && !cc.includes(e));
  const replyTo = unique(input.reply_to);
  const allRecipients = [...to, ...cc, ...bcc];

  if (allRecipients.length > MAX_RECIPIENTS) {
    return { ok: false, status: 400, body: { error: `At most ${MAX_RECIPIENTS} recipients across to, cc and bcc` } };
  }
  if (ctx.maxRecipients !== null && allRecipients.length > ctx.maxRecipients) {
    return { ok: false, status: 403, body: { error: `Your plan allows ${ctx.maxRecipients} recipient(s) per email.` } };
  }

  const senderError = await checkSender(ctx.id, from.email);
  if (senderError) {
    return { ok: false, status: 403, body: { error: senderError } };
  }

  const { data: suppressedRows } = await supabaseAdmin
    .from('suppressed')
    .select('email')
    .in('email', allRecipients)
    .or(`tenant_id.eq.${ctx.id},tenant_id.is.null`);
  const suppressed = new Set((suppressedRows ?? []).map((r: { email: string }) => r.email));

  const sendTo = to.filter((e) => !suppressed.has(e));
  const sendCc = cc.filter((e) => !suppressed.has(e));
  const sendBcc = bcc.filter((e) => !suppressed.has(e));
  const suppressedRecipients = allRecipients.filter((e) => suppressed.has(e));

  if (sendTo.length === 0) {
    return { ok: false, status: 422, body: { error: 'All "to" recipients are suppressed (bounced or complained)', suppressed: suppressedRecipients } };
  }

  const recipientCount = sendTo.length + sendCc.length + sendBcc.length;
  if (ctx.monthlyCount + recipientCount > ctx.monthlyLimit) {
    return {
      ok: false,
      status: 402,
      body: { error: 'Monthly email sending limit exceeded', hint: `Used ${ctx.monthlyCount} of ${ctx.monthlyLimit} this month.` },
    };
  }

  if (ctx.rateLimit && ctx.rateLimit > 0 && !env.AUTH_BYPASS && !tryConsume(ctx.id, recipientCount, ctx.rateLimit)) {
    return {
      ok: false,
      status: 429,
      body: { error: 'Rate limit exceeded', hint: `Your plan allows ${ctx.rateLimit} emails per minute. Try again shortly.` },
    };
  }

  // Authoritative, atomic quota check; the one above is a fast fail.
  if (!env.AUTH_BYPASS) {
    const { data: reserved, error: reserveError } = await supabaseAdmin.rpc('reserve_tenant_email_quota', {
      p_tenant_id: ctx.id,
      p_count: recipientCount,
    });
    if (reserveError) {
      console.error('[emails] Failed to reserve quota:', reserveError);
      return { ok: false, status: 500, body: { error: 'Failed to reserve monthly quota' } };
    }
    if (reserved === null) {
      return { ok: false, status: 402, body: { error: 'Monthly email sending limit exceeded', hint: `Your limit is ${ctx.monthlyLimit} emails.` } };
    }
  }
  ctx.monthlyCount += recipientCount;

  const releaseQuota = async () => {
    if (env.AUTH_BYPASS) return;
    const { error } = await supabaseAdmin.rpc('release_tenant_email_quota', { p_tenant_id: ctx.id, p_count: recipientCount });
    if (error) console.error('[emails] Failed to release quota:', error);
  };

  const jobId = randomUUID();
  let html = input.html;
  if (html && input.attachments?.length) {
    html = insertBeforeBodyEnd(html, renderAttachmentCards(input.attachments));
  }
  if (html && input.track_opens && ctx.trackOpens) {
    html = injectTrackingPixel(html, jobId, env.BASE_URL);
  }
  let text = input.text;
  if (text && input.attachments?.length) {
    text += `\n\nAttachments:\n${input.attachments.map((a) => `- ${a.filename}: ${a.url}`).join('\n')}`;
  }
  // email_jobs.html_hash is required, so text-only mail stores its text there.
  const storedContent = html ?? text!;
  const htmlHash = computeHtmlHash(storedContent);

  const { error: htmlError } = await supabaseAdmin
    .from('email_html_contents')
    .upsert({ hash: htmlHash, html: storedContent }, { onConflict: 'hash' });
  if (htmlError) {
    await releaseQuota();
    console.error('[emails] Failed to store html:', htmlError);
    return { ok: false, status: 500, body: { error: 'Failed to store email content' } };
  }

  const now = new Date().toISOString();
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('email_jobs')
    .insert({
      job_id: jobId,
      tenant_id: ctx.id,
      from_email: from.email,
      to_email: sendTo[0],
      to_emails: sendTo,
      cc_emails: sendCc.length ? sendCc : null,
      bcc_emails: sendBcc.length ? sendBcc : null,
      reply_to: replyTo.length ? replyTo : null,
      subject: input.subject,
      html_hash: htmlHash,
      status: ctx.isSandbox ? 'delivered' : 'queued',
      sent_at: ctx.isSandbox ? now : null,
      email_type: 'transactional',
      source: 'api',
      idempotency_key: idempotencyKey,
      request_hash: hash,
      attachments: input.attachments ?? null,
      tags: input.tags ?? null,
    })
    .select(EMAIL_COLUMNS)
    .single();

  if (insertError || !inserted) {
    await releaseQuota();
    // A concurrent request with the same key won the race.
    if (insertError?.code === '23505' && idempotencyKey) {
      const existing = await findByIdempotencyKey(ctx.id, idempotencyKey);
      if (existing) {
        return replayOrConflict(existing, hash);
      }
    }
    console.error('[emails] Failed to insert job:', insertError);
    return { ok: false, status: 500, body: { error: 'Failed to create email' } };
  }

  const extra = suppressedRecipients.length ? { suppressed: suppressedRecipients } : {};

  if (ctx.isSandbox) {
    // Nothing is sent, but emit events so webhook receivers can be tested.
    await supabaseAdmin.from('email_job_events').insert([
      { job_id: jobId, tenant_id: ctx.id, event_type: 'sent', metadata: { sandbox: true } },
      { job_id: jobId, tenant_id: ctx.id, event_type: 'delivered', metadata: { sandbox: true, email: sendTo[0] } },
    ]);
    return { ok: true, status: 202, body: { ...publicEmail(inserted), sandbox: true, ...extra } };
  }

  const message = buildEmailJobMessage({
    jobId,
    tenantId: ctx.id,
    from: from.email,
    fromName: from.name,
    to: sendTo[0],
    toList: sendTo,
    cc: sendCc,
    bcc: sendBcc,
    replyTo,
    subject: input.subject,
    html: html ?? '',
    text,
    configurationSetName: env.SES_CONFIGURATION_SET,
  });

  try {
    const sqsMessageId = await publishEmailJobMessage(message);
    await supabaseAdmin.from('email_jobs').update({ sqs_message_id: sqsMessageId }).eq('job_id', jobId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Failed to queue email';
    await supabaseAdmin
      .from('email_jobs')
      .update({ status: 'failed', failed_at: new Date().toISOString(), failure_reason: reason })
      .eq('job_id', jobId);
    await releaseQuota();
    return { ok: false, status: 502, body: { error: 'Failed to queue email', id: jobId } };
  }

  return { ok: true, status: 202, body: { ...publicEmail(inserted), ...extra } };
}

function readIdempotencyKey(request: Request, response: Response): string | null | undefined {
  const header = request.headers['idempotency-key'];
  if (header === undefined) {
    return null;
  }
  const parsed = idempotencyKeySchema.safeParse(Array.isArray(header) ? header[0] : header);
  if (!parsed.success) {
    response.status(400).json({ error: 'Idempotency-Key must be 1 to 200 characters' });
    return undefined;
  }
  return parsed.data;
}

emailsRouter.use(requireApiKey);

emailsRouter.post('/', async (request, response) => {
  const key = readIdempotencyKey(request, response);
  if (key === undefined) return;

  const result = await sendOne(tenantContext(request), request.body, key);
  if (result.ok && result.status === 200) {
    response.setHeader('Idempotent-Replayed', 'true');
  }
  response.status(result.status).json(result.body);
});

emailsRouter.post('/batch', async (request, response) => {
  const key = readIdempotencyKey(request, response);
  if (key === undefined) return;

  const parsed = batchSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: `Body must be { "emails": [...] } with 1 to ${MAX_BATCH} emails`, issues: parsed.error.flatten() });
    return;
  }

  const ctx = tenantContext(request);
  const results: Array<Record<string, unknown>> = [];
  // Sequential so quota and idempotency checks see earlier items.
  for (const [index, email] of parsed.data.emails.entries()) {
    const result = await sendOne(ctx, email, key ? `${key}:${index}` : null);
    results.push({ index, status: result.status, ...result.body });
  }

  const failed = results.filter((r) => (r.status as number) >= 400).length;
  response.status(failed === 0 ? 202 : failed === results.length ? 400 : 207).json({
    accepted: results.length - failed,
    failed,
    results,
  });
});

emailsRouter.get('/:id', async (request, response) => {
  if (!z.string().uuid().safeParse(request.params.id).success) {
    response.status(400).json({ error: 'Invalid email id' });
    return;
  }

  const tenantId = request.tenant?.id as string;
  const [job, events] = await Promise.all([
    supabaseAdmin.from('email_jobs').select(EMAIL_COLUMNS).eq('job_id', request.params.id).eq('tenant_id', tenantId).maybeSingle(),
    supabaseAdmin
      .from('email_job_events')
      .select('event_type, metadata, created_at')
      .eq('job_id', request.params.id)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true }),
  ]);

  if (job.error || events.error) {
    response.status(500).json({ error: 'Failed to load email' });
    return;
  }
  if (!job.data) {
    response.status(404).json({ error: 'Email not found' });
    return;
  }

  const row = job.data;
  response.json({
    ...publicEmail(row),
    bcc: row.bcc_emails ?? [],
    attachments: row.attachments ?? [],
    sent_at: row.sent_at,
    delivered_at: row.delivered_at,
    opened_at: row.opened_at,
    open_count: row.open_count ?? 0,
    failed_at: row.failed_at,
    failure_reason: row.failure_reason,
    events: (events.data ?? []).map((e) => ({ type: `email.${e.event_type}`, at: e.created_at, details: e.metadata ?? {} })),
  });
});
