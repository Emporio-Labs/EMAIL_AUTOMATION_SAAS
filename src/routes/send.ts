import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { env } from '../config/env';
import { requireAuth } from '../middleware/require-auth';
import { requireApiKey } from '../middleware/require-api-key';
import { requireTenant } from '../middleware/require-tenant';
import { supabaseAdmin } from '../lib/supabase';
import { buildEmailJobMessage, publishEmailJobMessages } from '../lib/sqs';
import { normalizeEmail } from '../utils/normalize-email';
import { generateUnsubscribeToken } from '../utils/unsubscribe-token';
import { computeHtmlHash } from '../utils/hash';
import { PLAN_LIMITS, resolvePlanLimit, resolvePlanBooleanLimit, PlanName } from '../config/plans';
import { escapeHtml, injectTrackingPixel, rewriteLinks } from '../lib/tracker';
import { tryConsume } from '../utils/rate-limiter';

export const sendRouter = Router();

// PostgREST puts `.in()` filters in the URL; keep each list small enough that a
// 1,000-recipient send does not hit URL length limits.
const IN_FILTER_CHUNK = 150;

function chunk<T>(items: T[], size = IN_FILTER_CHUNK): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

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

// The send pipeline, shared by POST /v1/send and the campaign scheduler.
export type SendRequest = Pick<Request, 'body' | 'tenant' | 'apiKey' | 'keyType'>;
export type SendResponse = {
  status(code: number): { json(body: unknown): unknown };
  setHeader(name: string, value: string): unknown;
};

sendRouter.post('/', (request, response) => handleSend(request, response));

export async function handleSend(request: SendRequest, response: SendResponse): Promise<void> {
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
      // With toEmails, only look those up (the scheduler's chunks); otherwise
      // the whole campaign.
      const campaignContactResults = directRecipients.length > 0
        ? await Promise.all(
            chunk(directRecipients).map((emails) =>
              supabaseAdmin
                .from('campaign_contacts')
                .select('email')
                .eq('campaign_id', parsed.data.campaignId as string)
                .in('email', emails),
            ),
          )
        : [await supabaseAdmin.from('campaign_contacts').select('email').eq('campaign_id', parsed.data.campaignId)];
      const campaignContactsError = campaignContactResults.find((result) => result.error)?.error;
      const campaignContacts = campaignContactResults.flatMap((result) => result.data ?? []);

      if (campaignContactsError && !env.AUTH_BYPASS) {
        response.status(500).json({ error: 'Failed to resolve campaign contacts' });
        return;
      }

      const campaignEmails = Array.from(new Set((campaignContacts ?? []).map((row) => normalizeEmail(row.email))));
      if (campaignEmails.length === 0) {
        response.status(400).json({ error: 'Campaign has no recipients' });
        return;
      }

      const subscribedResults = await Promise.all(
        chunk(campaignEmails).map((emails) =>
          supabaseAdmin
            .from('contacts')
            .select('email')
            .eq('tenant_id', tenantId as string)
            .eq('is_subscribed', true)
            .in('email', emails),
        ),
      );
      const subscribedContactsError = subscribedResults.find((result) => result.error)?.error;
      const subscribedContacts = subscribedResults.flatMap((result) => result.data ?? []);

      if (subscribedContactsError && !env.AUTH_BYPASS) {
        response.status(500).json({ error: 'Failed to resolve subscribed campaign contacts' });
        return;
      }

      campaignRecipients = Array.from(new Set((subscribedContacts ?? []).map((row) => normalizeEmail(row.email))));
    }
  }

  // Lists must belong to this tenant; list_contacts has no tenant column of its own.
  if (parsed.data.listIds && parsed.data.listIds.length > 0) {
    const requestedListIds = Array.from(new Set(parsed.data.listIds));
    const { data: ownedLists, error: ownedListsError } = await supabaseAdmin
      .from('lists')
      .select('id')
      .eq('tenant_id', tenantId as string)
      .in('id', requestedListIds);

    if (ownedListsError) {
      response.status(500).json({ error: 'Failed to resolve lists' });
      return;
    }

    if ((ownedLists ?? []).length !== requestedListIds.length) {
      response.status(404).json({ error: 'One or more lists were not found' });
      return;
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
          .select('contact_id, contacts!inner(id, email, tenant_id, is_subscribed)')
          .in('list_id', parsed.data.listIds)
          .eq('contacts.tenant_id', tenantId as string)
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
  type ListContact = { email: string; is_subscribed?: boolean };
  const isMarketing = parsed.data.emailType === 'marketing';
  const resolvedFromLists = (listRowsResult.error ? [] : listRowsResult.data ?? []).flatMap((row) => {
    const contacts = row.contacts as unknown;
    const rows: ListContact[] = Array.isArray(contacts)
      ? (contacts as ListContact[])
      : contacts && typeof contacts === 'object' && 'email' in contacts
        ? [contacts as ListContact]
        : [];

    // Unsubscribed contacts still get transactional mail, never marketing.
    return rows
      .filter((contact) => !isMarketing || contact.is_subscribed !== false)
      .map((contact) => normalizeEmail(contact.email));
  });

  // With a campaign, toEmails (if given) picks a subset of its recipients;
  // the scheduler uses this to send a campaign in chunks.
  const directSet = new Set(directRecipients);
  const campaignSubset = directRecipients.length > 0
    ? campaignRecipients.filter((email) => directSet.has(email))
    : campaignRecipients;

  const uniqueRecipients = parsed.data.campaignId && parsed.data.emailType === 'marketing'
    ? campaignSubset
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
  // Unsubscribes only block marketing; bounces and complaints block everything.
  const blockingReasons = parsed.data.emailType === 'marketing'
    ? ['bounce', 'complaint', 'unsubscribe']
    : ['bounce', 'complaint'];
  const suppressedResults = await Promise.all(
    chunk(uniqueRecipients).map((emails) =>
      supabaseAdmin
        .from('suppressed')
        .select('email')
        .in('email', emails)
        .in('reason', blockingReasons)
        .or(`tenant_id.eq.${tenantId},tenant_id.is.null`),
    ),
  );

  if (suppressedResults.some((result) => result.error) && !env.AUTH_BYPASS) {
    response.status(500).json({ error: 'Failed to check suppression list' });
    return;
  }

  const suppressedSet = new Set(
    suppressedResults.flatMap((result) => (result.data ?? []).map((r: { email: string }) => r.email)),
  );
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

  // ── Per-minute rate limit ──────────────────────────────────────────────────
  // Applies to API-key sends. Dashboard sends (a person sending to a list or
  // campaign) are bounded by max_recipients_per_send and the monthly quota
  // instead, so a large list is not rejected outright by a per-minute cap.
  const rateLimit = request.tenant?.rateLimit;
  if (request.apiKey && rateLimit && rateLimit > 0 && !env.AUTH_BYPASS) {
    if (!tryConsume(tenantId as string, emailsToSend, rateLimit)) {
      response.setHeader('Retry-After', '60');
      response.status(429).json({
        error: 'Rate limit exceeded',
        hint: `Your plan allows ${rateLimit} emails per minute. Try again shortly.`,
      });
      return;
    }
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

    // 1. Inject unsubscribe footer (marketing only: receipts, bills and
    //    password resets must not offer an unsubscribe that blocks them).
    if (parsed.data.emailType === 'marketing') {
      const unsubToken = generateUnsubscribeToken(email, tenantId as string);
      const unsubUrl = `${env.BASE_URL}/v1/unsubscribe?t=${encodeURIComponent(unsubToken)}`;
      const tenantName = escapeHtml(request.tenant?.name || 'our service');
      const footerHtml = `<div style="margin-top: 20px; border-top: 1px solid #eee; padding-top: 10px; font-size: 12px; color: #666; text-align: center;">You are receiving this email from ${tenantName}. If you no longer wish to receive these emails, you can <a href="${unsubUrl}" style="color: #007bff; text-decoration: underline;">unsubscribe here</a>.</div>`;

      const bodyIndex = html.toLowerCase().lastIndexOf('</body>');
      if (bodyIndex === -1) {
        html = html + footerHtml;
      } else {
        html = html.substring(0, bodyIndex) + footerHtml + html.substring(bodyIndex);
      }
    }

    // 2. Inject tracking pixel if trackOpens is true
    if (trackOpens) {
      html = injectTrackingPixel(html, jobId, env.BASE_URL);
    }

    // 3. Rewrite links for click tracking if trackClicks is true
    if (trackClicks) {
      html = rewriteLinks(html, jobId, env.BASE_URL, env.INTERNAL_KEY);
    }

    const htmlHash = computeHtmlHash(html);

    return {
      job_id: jobId,
      tenant_id: tenantId as string,
      campaign_id: parsed.data.campaignId ?? null,
      from_email: fromEmail,
      to_email: email,
      subject: parsed.data.subject,
      html_hash: htmlHash,
      _inMemoryHtml: html,
      status: isSandbox ? 'delivered' : 'queued',
      sent_at: sentAt,
      email_type: parsed.data.emailType,
    };
  });

  // ── Reserve monthly quota atomically ───────────────────────────────────────
  // The check above is a fast fail; this is the authoritative one.
  if (!env.AUTH_BYPASS) {
    const { data: reserved, error: reserveError } = await supabaseAdmin.rpc('reserve_tenant_email_quota', {
      p_tenant_id: tenantId,
      p_count: emailsToSend,
    });

    if (reserveError) {
      console.error('[send] Failed to reserve quota:', reserveError);
      response.status(500).json({ error: 'Failed to reserve monthly quota' });
      return;
    }

    if (reserved === null) {
      response.status(402).json({
        error: 'Monthly email sending limit exceeded',
        hint: `Sending this batch of ${emailsToSend} emails would exceed your limit of ${monthlyLimit}. Please upgrade your plan or contact support.`,
      });
      return;
    }
  }

  const releaseQuota = async (count: number) => {
    if (count <= 0 || env.AUTH_BYPASS) return;
    const { error } = await supabaseAdmin.rpc('release_tenant_email_quota', { p_tenant_id: tenantId, p_count: count });
    if (error) console.error('[send] Failed to release quota:', error);
  };

  // Extract unique HTML hashes and their content to save database space
  const uniqueHtmls = Array.from(
    new Map(jobRows.map((row) => [row.html_hash, row._inMemoryHtml])).entries()
  ).map(([hash, html]) => ({ hash, html }));

  // Upsert deduplicated HTML content
  const { error: htmlInsertError } = await supabaseAdmin
    .from('email_html_contents')
    .upsert(uniqueHtmls, { onConflict: 'hash' });

  if (htmlInsertError && !env.AUTH_BYPASS) {
    console.error('[send] Failed to upsert email html contents:', htmlInsertError);
    await releaseQuota(emailsToSend);
    response.status(500).json({ error: 'Failed to create email jobs (HTML storage error)' });
    return;
  }

  // Remove the temporary _inMemoryHtml property before inserting into email_jobs
  const dbJobRows = jobRows.map(({ _inMemoryHtml, ...row }) => row);

  const { data: insertedJobs, error: insertError } = await supabaseAdmin
    .from('email_jobs')
    .insert(dbJobRows)
    .select('job_id, tenant_id, contact_id, list_id, from_email, to_email, subject, html_hash, email_type');

  if ((insertError || !insertedJobs) && !env.AUTH_BYPASS) {
    await releaseQuota(emailsToSend);
    response.status(500).json({ error: 'Failed to create email jobs' });
    return;
  }

  const jobRowsById = new Map(jobRows.map((row) => [row.job_id, row]));
  const jobsToPublish = insertError || !insertedJobs
    ? jobRows.map((job) => ({
        job_id: job.job_id,
        tenant_id: job.tenant_id,
        contact_id: null,
        list_id: null,
        from_email: job.from_email,
        to_email: job.to_email,
        subject: job.subject,
        html: job._inMemoryHtml,
        email_type: job.email_type,
      }))
    : insertedJobs.map((job) => {
        const originalJob = jobRowsById.get(job.job_id);
        return {
          job_id: job.job_id,
          tenant_id: job.tenant_id,
          contact_id: job.contact_id,
          list_id: job.list_id,
          from_email: job.from_email,
          to_email: job.to_email,
          subject: job.subject,
          html: originalJob?._inMemoryHtml || '',
          email_type: job.email_type,
        };
      });

  if (isSandbox) {
    response.status(202).json({
      accepted: sendableRecipients.length,
      jobIds: jobsToPublish.map((job) => job.job_id),
      sandbox: true,
    });
    return;
  }

  const messages = jobsToPublish.map((job) => {
    const headers: Array<{ name: string; value: string }> = [];
    if (job.email_type === 'marketing') {
      const unsubToken = generateUnsubscribeToken(job.to_email, job.tenant_id);
      const unsubUrl = `${env.BASE_URL}/v1/unsubscribe?t=${encodeURIComponent(unsubToken)}`;
      headers.push({ name: 'List-Unsubscribe', value: `<${unsubUrl}>` });
      headers.push({ name: 'List-Unsubscribe-Post', value: 'List-Unsubscribe=One-Click' });
    }

    return {
      jobId: job.job_id,
      body: buildEmailJobMessage({
        jobId: job.job_id,
        tenantId: job.tenant_id,
        from: job.from_email,
        to: job.to_email,
        subject: job.subject,
        html: job.html,
        configurationSetName: env.SES_CONFIGURATION_SET,
        headers,
      }),
    };
  });

  const { published: publishedJobs, failed: failedJobs } = await publishEmailJobMessages(messages);

  if (failedJobs.length > 0) {
    // Group by reason so this is a handful of updates, not one per job.
    const byReason = new Map<string, string[]>();
    for (const failed of failedJobs) {
      byReason.set(failed.reason, [...(byReason.get(failed.reason) ?? []), failed.jobId]);
    }
    const failedAt = new Date().toISOString();
    await Promise.all(
      Array.from(byReason.entries()).flatMap(([reason, jobIds]) =>
        chunk(jobIds).map((ids) =>
          supabaseAdmin
            .from('email_jobs')
            .update({ status: 'failed', failed_at: failedAt, failure_reason: reason })
            .in('job_id', ids),
        ),
      ),
    );
    await releaseQuota(failedJobs.length);
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
}
