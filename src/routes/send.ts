import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { env } from '../config/env';
import { requireAuth } from '../middleware/require-auth';
import { requireApiKey } from '../middleware/require-api-key';
import { requireTenant } from '../middleware/require-tenant';
import { supabaseAdmin } from '../lib/supabase';
import { buildEmailJobMessage, publishEmailJobMessage } from '../lib/sqs';
import { normalizeEmail } from '../utils/normalize-email';
import { generateUnsubscribeToken } from '../utils/unsubscribe-token';
import { PLAN_LIMITS, resolvePlanLimit, resolvePlanBooleanLimit, PlanName } from '../config/plans';
import { injectTrackingPixel, rewriteLinks } from '../lib/tracker';

export const sendRouter = Router();

const sendSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  html: z.string().trim().min(1),
  from: z.string().trim().email('"from" must be a valid email address using your verified domain'),
  toEmails: z.array(z.string().email()).optional(),
  contactIds: z.array(z.string().uuid()).optional(),
  listIds: z.array(z.string().uuid()).optional(),
  campaignId: z.string().uuid().optional(),
  emailType: z.enum(['transactional', 'marketing']).default('marketing'),
}).refine(
  (val) => {
    const explicitRecipientCount = (val.toEmails?.length ?? 0) + (val.contactIds?.length ?? 0) + (val.listIds?.length ?? 0);
    if (explicitRecipientCount > 0) {
      return true;
    }

    return Boolean(val.campaignId && val.emailType === 'marketing');
  },
  { message: 'Provide recipients via toEmails/contactIds/listIds or marketing campaignId' },
);

function hasApiKeyHeader(request: Request): boolean {
  return typeof request.headers['x-api-key'] !== 'undefined';
}

async function requireSendAuth(request: Request, response: Response, next: NextFunction): Promise<void> {
  if (hasApiKeyHeader(request)) {
    await requireApiKey(request, response, next);
    return;
  }

  await requireAuth(request, response, () => undefined);
  if (response.headersSent) {
    return;
  }

  await requireTenant(request, response, next);
}

sendRouter.use(requireSendAuth);

sendRouter.post('/', async (request, response) => {
  const parsed = sendSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
    return;
  }

  const tenantId = request.tenant?.id;
  const forceSandbox = request.tenant?.force_sandbox ?? false;
  const isSandbox = request.keyType === 'sandbox' || forceSandbox;
  const fromEmail = normalizeEmail(parsed.data.from);
  const directRecipients = (parsed.data.toEmails ?? []).map(normalizeEmail);

  const plan = request.tenant?.plan as PlanName;
  const trialEndsAt = request.tenant?.trial_ends_at;
  const effectivePlan: PlanName = (trialEndsAt && new Date() > new Date(trialEndsAt)) ? 'free' : plan;

  let campaignRecipients: string[] = [];

  if (parsed.data.campaignId) {
    const { data: campaignRow, error: campaignError } = await supabaseAdmin
      .from('campaigns')
      .select('id')
      .eq('id', parsed.data.campaignId)
      .eq('tenant_id', tenantId as string)
      .maybeSingle();

    if ((campaignError || !campaignRow) && !env.AUTH_BYPASS) {
      response.status(404).json({ error: 'Campaign not found for this tenant' });
      return;
    }

    if (parsed.data.emailType === 'marketing') {
      const { data: campaignContacts, error: campaignContactsError } = await supabaseAdmin
        .from('campaign_contacts')
        .select('email')
        .eq('campaign_id', parsed.data.campaignId);

      if (campaignContactsError && !env.AUTH_BYPASS) {
        response.status(500).json({ error: 'Failed to resolve campaign contacts' });
        return;
      }

      const campaignEmails = Array.from(new Set((campaignContacts ?? []).map((row) => normalizeEmail(row.email))));
      if (campaignEmails.length === 0) {
        response.status(400).json({ error: 'Campaign has no recipients' });
        return;
      }

      const { data: subscribedContacts, error: subscribedContactsError } = await supabaseAdmin
        .from('contacts')
        .select('email')
        .eq('tenant_id', tenantId as string)
        .eq('is_subscribed', true)
        .in('email', campaignEmails);

      if (subscribedContactsError && !env.AUTH_BYPASS) {
        response.status(500).json({ error: 'Failed to resolve subscribed campaign contacts' });
        return;
      }

      campaignRecipients = Array.from(new Set((subscribedContacts ?? []).map((row) => normalizeEmail(row.email))));
    }
  }

  const [contactRowsResult, listRowsResult] = await Promise.all([
    parsed.data.contactIds && parsed.data.contactIds.length > 0
      ? supabaseAdmin
          .from('contacts')
          .select('id, email')
          .eq('tenant_id', tenantId as string)
          .in('id', parsed.data.contactIds)
      : Promise.resolve({ data: [], error: null }),
    parsed.data.listIds && parsed.data.listIds.length > 0
      ? supabaseAdmin
          .from('list_contacts')
          .select('contact_id, contacts!inner(id, email)')
          .in('list_id', parsed.data.listIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (contactRowsResult.error && !env.AUTH_BYPASS) {
    response.status(500).json({ error: 'Failed to resolve contacts' });
    return;
  }

  if (listRowsResult.error && !env.AUTH_BYPASS) {
    response.status(500).json({ error: 'Failed to resolve lists' });
    return;
  }

  const resolvedFromContacts = (contactRowsResult.error ? [] : contactRowsResult.data ?? []).map((contact) =>
    normalizeEmail(contact.email),
  );
  const resolvedFromLists = (listRowsResult.error ? [] : listRowsResult.data ?? []).flatMap((row) => {
    const contacts = row.contacts;
    if (Array.isArray(contacts)) {
      return contacts.map((contact: { email: string }) => normalizeEmail(contact.email));
    }

    if (contacts && typeof contacts === 'object' && 'email' in contacts) {
      return [normalizeEmail((contacts as { email: string }).email)];
    }

    return [];
  });

  const uniqueRecipients = parsed.data.campaignId && parsed.data.emailType === 'marketing'
    ? campaignRecipients
    : Array.from(new Set([...directRecipients, ...resolvedFromContacts, ...resolvedFromLists]));

  if (uniqueRecipients.length === 0) {
    response.status(400).json({ error: 'No recipients resolved' });
    return;
  }

  // ── Limits check before suppression ─────────────────────────────────────────
  const planLimits = PLAN_LIMITS[effectivePlan];
  const maxRecipients = resolvePlanLimit(request.tenant?.max_recipients_per_send, planLimits.max_recipients_per_send);
  if (maxRecipients !== null && uniqueRecipients.length > maxRecipients) {
    response.status(403).json({ error: `Recipient limit of ${maxRecipients} exceeded.` });
    return;
  }

  const canMarketing = resolvePlanBooleanLimit(request.tenant?.can_send_marketing, planLimits.can_send_marketing);
  if (parsed.data.emailType === 'marketing' && !canMarketing) {
    response.status(403).json({ error: 'Marketing emails require Starter plan or above.' });
    return;
  }

  // ── Suppression filter ────────────────────────────────────────────────────
  // Block any address that has previously bounced or been complained about.
  // We check for platform-wide suppressions (tenant_id IS NULL) or tenant-specific suppressions.
  const { data: suppressedRows } = await supabaseAdmin
    .from('suppressed')
    .select('email')
    .in('email', uniqueRecipients)
    .or(`tenant_id.eq.${tenantId},tenant_id.is.null`);

  const suppressedSet = new Set((suppressedRows ?? []).map((r: { email: string }) => r.email));
  const suppressedRecipients = uniqueRecipients.filter((e) => suppressedSet.has(e));
  const sendableRecipients = uniqueRecipients.filter((e) => !suppressedSet.has(e));

  if (suppressedRecipients.length > 0) {
    console.log('[send] Filtered suppressed recipients:', suppressedRecipients);
  }

  if (sendableRecipients.length === 0) {
    response.status(422).json({ error: 'All recipients are suppressed', suppressedRecipients });
    return;
  }

  // ── Monthly limit check ────────────────────────────────────────────────────
  const monthlyLimit = request.tenant?.monthlyEmailLimit ?? 1000;
  const currentMonthlyCount = request.tenant?.monthlyEmailCount ?? 0;
  const emailsToSend = sendableRecipients.length;

  if (currentMonthlyCount + emailsToSend > monthlyLimit) {
    response.status(402).json({
      error: 'Monthly email sending limit exceeded',
      hint: `You have sent ${currentMonthlyCount} of ${monthlyLimit} emails. Sending this batch of ${emailsToSend} emails would exceed your limit. Please upgrade your plan or contact support.`,
    });
    return;
  }

  // ── Domain verification guard ───────────────────────────────────────────────
  // Only allow sending if the from_email domain is registered AND verified
  // for this tenant. This replaces the old hardcoded DEFAULT_FROM_EMAIL.
  if (!env.AUTH_BYPASS) {
    const sendingDomain = fromEmail.split('@')[1]?.toLowerCase();

    if (!sendingDomain) {
      response.status(400).json({ error: 'Invalid from address' });
      return;
    }

    const [domainCheck, verifiedDomains, addressCheck, registeredAddresses] = await Promise.all([
      supabaseAdmin
        .from('domains')
        .select('id, verified')
        .eq('tenant_id', tenantId as string)
        .eq('domain', sendingDomain)
        .maybeSingle(),
      supabaseAdmin
        .from('domains')
        .select('domain')
        .eq('tenant_id', tenantId as string)
        .eq('verified', true)
        .limit(3),
      supabaseAdmin
        .from('sending_addresses')
        .select('id, address')
        .eq('tenant_id', tenantId as string)
        .eq('address', fromEmail)
        .maybeSingle(),
      supabaseAdmin
        .from('sending_addresses')
        .select('address')
        .eq('tenant_id', tenantId as string)
        .limit(3),
    ]);

    if (domainCheck.error) {
      response.status(500).json({ error: 'Failed to check sending domain' });
      return;
    }

    if (addressCheck.error) {
      response.status(500).json({ error: 'Failed to check sending address' });
      return;
    }

    const domainSuggestion =
      (verifiedDomains.data ?? [])
        .map((d) => `no-reply@${d.domain}`)
        .join(', ');

    const addressSuggestion =
      (registeredAddresses.data ?? [])
        .map((row) => row.address)
        .join(', ');

    if (!domainCheck.data) {
      response.status(403).json({
        error: `Domain "${sendingDomain}" is not registered for this tenant.`,
        hint: 'Add it at POST /v1/domains, publish the CNAME records, then verify.',
        verifiedDomains: domainSuggestion || 'No verified domains yet.',
      });
      return;
    }

    if (!domainCheck.data.verified) {
      response.status(403).json({
        error: `Domain "${sendingDomain}" is registered but not yet verified.`,
        hint: `Publish the CNAME records and call GET /v1/domains/${domainCheck.data.id}/verify.`,
        verifiedDomains: domainSuggestion || 'No verified domains yet.',
      });
      return;
    }

    if (!addressCheck.data) {
      response.status(403).json({
        error: `Address "${fromEmail}" is not registered for this tenant.`,
        hint: 'Add it at POST /v1/sending-addresses.',
        registeredAddresses: addressSuggestion || 'No registered addresses yet.',
      });
      return;
    }
  }

  // ── Open and Click Tracking Settings ───────────────────────────────────────
  const trackOpens = resolvePlanBooleanLimit(request.tenant?.can_track_opens, planLimits.can_track_opens);
  const trackClicks = resolvePlanBooleanLimit(request.tenant?.can_track_clicks, planLimits.can_track_clicks);

  const sentAt = isSandbox ? new Date().toISOString() : null;
  const jobRows = sendableRecipients.map((email) => {
    const jobId = randomUUID();
    let html = parsed.data.html;

    // 1. Inject unsubscribe footer
    const unsubToken = generateUnsubscribeToken(email, tenantId as string);
    const unsubUrl = `${env.BASE_URL}/v1/unsubscribe?t=${unsubToken}`;
    const tenantName = request.tenant?.name || 'our service';
    const footerHtml = `<div style="margin-top: 20px; border-top: 1px solid #eee; padding-top: 10px; font-size: 12px; color: #666; text-align: center;">You are receiving this email from ${tenantName}. If you no longer wish to receive these emails, you can <a href="${unsubUrl}" style="color: #007bff; text-decoration: underline;">unsubscribe here</a>.</div>`;

    // Inject footerHtml before </body> or at the end of html
    const bodyIndex = html.toLowerCase().lastIndexOf('</body>');
    if (bodyIndex === -1) {
      html = html + footerHtml;
    } else {
      html = html.substring(0, bodyIndex) + footerHtml + html.substring(bodyIndex);
    }

    // 2. Inject tracking pixel if trackOpens is true
    if (trackOpens) {
      html = injectTrackingPixel(html, jobId, env.BASE_URL);
    }

    // 3. Rewrite links for click tracking if trackClicks is true
    if (trackClicks) {
      html = rewriteLinks(html, jobId, env.BASE_URL);
    }

    return {
      job_id: jobId,
      tenant_id: tenantId as string,
      campaign_id: parsed.data.campaignId ?? null,
      from_email: fromEmail,
      to_email: email,
      subject: parsed.data.subject,
      html: html,
      status: isSandbox ? 'delivered' : 'queued',
      sent_at: sentAt,
      email_type: parsed.data.emailType,
    };
  });

  const { data: insertedJobs, error: insertError } = await supabaseAdmin
    .from('email_jobs')
    .insert(jobRows)
    .select('job_id, tenant_id, contact_id, list_id, from_email, to_email, subject, html, email_type');

  if ((insertError || !insertedJobs) && !env.AUTH_BYPASS) {
    response.status(500).json({ error: 'Failed to create email jobs' });
    return;
  }

  // Increment monthly email count for the tenant
  const { error: incrementError } = await supabaseAdmin.rpc('increment_tenant_email_count', {
    tenant_id: tenantId,
    increment_by: emailsToSend,
  });

  if (incrementError) {
    console.error('[send] Failed to increment email count via RPC, attempting fallback:', incrementError);
    await supabaseAdmin
      .from('tenants')
      .update({ monthly_email_count: currentMonthlyCount + emailsToSend })
      .eq('id', tenantId as string);
  }

  const jobsToPublish = insertError || !insertedJobs
    ? jobRows.map((job) => ({
        job_id: job.job_id,
        tenant_id: job.tenant_id,
        contact_id: null,
        list_id: null,
        from_email: job.from_email,
        to_email: job.to_email,
        subject: job.subject,
        html: job.html,
        email_type: job.email_type,
      }))
    : insertedJobs;

  if (isSandbox) {
    response.status(202).json({
      accepted: sendableRecipients.length,
      jobIds: jobsToPublish.map((job) => job.job_id),
      sandbox: true,
    });
    return;
  }

  const publishedJobs = [] as Array<{ jobId: string; sqsMessageId: string | null }>;
  const failedJobs = [] as Array<{ jobId: string; reason: string }>;

  for (const job of jobsToPublish) {
    const headers: Array<{ name: string; value: string }> = [];
    if (job.email_type === 'marketing') {
      const unsubToken = generateUnsubscribeToken(job.to_email, job.tenant_id);
      const unsubUrl = `${env.BASE_URL}/v1/unsubscribe?t=${unsubToken}`;
      headers.push({ name: 'List-Unsubscribe', value: `<${unsubUrl}>` });
      headers.push({ name: 'List-Unsubscribe-Post', value: 'List-Unsubscribe=One-Click' });
    }

    const messageBody = buildEmailJobMessage({
      jobId: job.job_id,
      tenantId: job.tenant_id,
      from: job.from_email,
      to: job.to_email,
      subject: job.subject,
      html: job.html,
      configurationSetName: env.SES_CONFIGURATION_SET,
      headers,
    });

    try {
      const messageId = await publishEmailJobMessage(messageBody);
      publishedJobs.push({ jobId: job.job_id, sqsMessageId: messageId });

      await supabaseAdmin
        .from('email_jobs')
        .update({ sqs_message_id: messageId })
        .eq('job_id', job.job_id);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Failed to publish to SQS';
      failedJobs.push({ jobId: job.job_id, reason });

      await supabaseAdmin
        .from('email_jobs')
        .update({
          status: 'failed',
          failed_at: new Date().toISOString(),
          failure_reason: reason,
        })
        .eq('job_id', job.job_id);
    }
  }

  if (publishedJobs.length === 0 && failedJobs.length > 0) {
    response.status(502).json({
      accepted: sendableRecipients.length,
      jobIds: jobsToPublish.map((job) => job.job_id),
      publishedJobs,
      failedJobs,
    });
    return;
  }

  response.status(failedJobs.length > 0 ? 207 : 202).json({
    accepted: sendableRecipients.length,
    jobIds: jobsToPublish.map((job) => job.job_id),
    publishedJobs,
    failedJobs,
  });
});