import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { env } from '../config/env';
import { requireAuth } from '../middleware/require-auth';
import { requireTenant } from '../middleware/require-tenant';
import { supabaseAdmin } from '../lib/supabase';
import { buildEmailJobMessage, publishEmailJobMessage } from '../lib/sqs';
import { normalizeEmail } from '../utils/normalize-email';

export const sendRouter = Router();

const sendSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  html: z.string().trim().min(1),
  from: z.string().email().optional(),
  toEmails: z.array(z.string().email()).optional(),
  contactIds: z.array(z.string().uuid()).optional(),
  listIds: z.array(z.string().uuid()).optional(),
});

sendRouter.use(requireAuth, requireTenant);

sendRouter.post('/', async (request, response) => {
  const parsed = sendSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
    return;
  }

  const tenantId = request.tenant?.id;
  const fromEmail = parsed.data.from ?? env.DEFAULT_FROM_EMAIL;
  const directRecipients = (parsed.data.toEmails ?? []).map(normalizeEmail);

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

  const uniqueRecipients = Array.from(new Set([...directRecipients, ...resolvedFromContacts, ...resolvedFromLists]));

  if (uniqueRecipients.length === 0) {
    response.status(400).json({ error: 'No recipients resolved' });
    return;
  }

  const jobRows = uniqueRecipients.map((email) => ({
    tenant_id: tenantId as string,
    from_email: fromEmail,
    to_email: email,
    subject: parsed.data.subject,
    html: parsed.data.html,
    status: 'queued',
  }));

  const { data: insertedJobs, error: insertError } = await supabaseAdmin
    .from('email_jobs')
    .insert(jobRows)
    .select('job_id, tenant_id, contact_id, list_id, from_email, to_email, subject, html');

  if ((insertError || !insertedJobs) && !env.AUTH_BYPASS) {
    response.status(500).json({ error: 'Failed to create email jobs' });
    return;
  }

  const jobsToPublish = insertError || !insertedJobs
    ? jobRows.map((job) => ({
        job_id: randomUUID(),
        tenant_id: job.tenant_id,
        contact_id: null,
        list_id: null,
        from_email: job.from_email,
        to_email: job.to_email,
        subject: job.subject,
        html: job.html,
      }))
    : insertedJobs;

  const publishedJobs = [] as Array<{ jobId: string; sqsMessageId: string | null }>;
  const failedJobs = [] as Array<{ jobId: string; reason: string }>;

  for (const job of jobsToPublish) {
    const messageBody = buildEmailJobMessage({
      jobId: job.job_id,
      tenantId: job.tenant_id,
      from: job.from_email,
      to: job.to_email,
      subject: job.subject,
      html: job.html,
    });

    try {
      const messageId = await publishEmailJobMessage(messageBody);
      publishedJobs.push({ jobId: job.job_id, sqsMessageId: messageId });

      await supabaseAdmin
        .from('email_jobs')
        .update({
          sqs_message_id: messageId,
        })
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
      accepted: uniqueRecipients.length,
      jobIds: jobsToPublish.map((job) => job.job_id),
      publishedJobs,
      failedJobs,
    });
    return;
  }

  response.status(failedJobs.length > 0 ? 207 : 202).json({
    accepted: uniqueRecipients.length,
    jobIds: jobsToPublish.map((job) => job.job_id),
    publishedJobs,
    failedJobs,
  });
});