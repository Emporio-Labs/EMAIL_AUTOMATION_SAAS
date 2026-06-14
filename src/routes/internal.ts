import { Router } from 'express';
import { z } from 'zod';
import https from 'https';
import crypto from 'crypto';
import { env } from '../config/env';
import { supabaseAdmin } from '../lib/supabase';

export const internalRouter = Router();

const jobStatusSchema = z
  .object({
    jobId: z.string().uuid().optional(),
    job_id: z.string().uuid().optional(),
    status: z.enum(['delivered', 'failed']),
    failureReason: z.string().optional(),
    failure_reason: z.string().optional(),
  })
  .refine((data) => data.jobId || data.job_id, {
    message: 'jobId is required',
    path: ['jobId'],
  })
  .refine((data) => !data.jobId || !data.job_id || data.jobId === data.job_id, {
    message: 'jobId and job_id must match',
    path: ['jobId'],
  })
  .transform((data) => ({
    jobId: data.jobId ?? data.job_id!,
    status: data.status,
    failureReason: data.failureReason ?? data.failure_reason,
  }));

internalRouter.post('/job-status', async (request, response) => {
  // ── Auth: shared secret ───────────────────────────────────────────────────
  const key = request.headers['x-internal-key'];
  if (!key || key !== env.INTERNAL_KEY) {
    response.status(401).json({ error: 'Unauthorized' });
    return;
  }

  // ── Validate body ─────────────────────────────────────────────────────────
  const parsed = jobStatusSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
    return;
  }

  const { jobId, status, failureReason } = parsed.data;

  // ── Build update payload ──────────────────────────────────────────────────
  const now = new Date().toISOString();
  const updatePayload: Record<string, string | null> = { status };

  if (status === 'delivered') {
    updatePayload.sent_at = now;
  } else if (status === 'failed') {
    updatePayload.failed_at = now;
    updatePayload.failure_reason = failureReason ?? null;
  }

  // ── Persist ───────────────────────────────────────────────────────────────
  const { error } = await supabaseAdmin
    .from('email_jobs')
    .update(updatePayload)
    .eq('job_id', jobId);

  if (error) {
    console.error('[internal/job-status] update error:', error);
    response.status(500).json({ error: 'Failed to update job status' });
    return;
  }

  response.status(200).json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// SNS Signature Verification Helpers
// ─────────────────────────────────────────────────────────────────────────────

// Only trust certificate URLs from real AWS SNS endpoints.
const SNS_CERT_URL_PATTERN = /^https:\/\/sns\.[a-z0-9-]+\.amazonaws\.com\//;

/** Fetch a remote URL body as a string (wraps https.get in a Promise). */
function httpsGetBody(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = '';
        res.on('data', (chunk: string) => { data += chunk; });
        res.on('end', () => resolve(data));
      })
      .on('error', reject);
  });
}

/**
 * Build the canonical string SNS expects to be signed.
 * Field order is defined by AWS — do not sort alphabetically.
 */
function buildSnsStringToSign(body: Record<string, unknown>): string {
  const notificationFields = ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'];
  const subscriptionFields = ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'];
  const fields = body.Type === 'Notification' ? notificationFields : subscriptionFields;

  return fields
    .filter((f) => body[f] !== undefined && body[f] !== null)
    .map((f) => `${f}\n${body[f] as string}\n`)
    .join('');
}

/**
 * Verify the SNS message signature.
 * Throws if the URL is untrusted or the signature is invalid.
 */
async function verifySnsSignature(body: Record<string, unknown>): Promise<void> {
  const certUrl = body.SigningCertURL as string | undefined;
  const signature = body.Signature as string | undefined;
  const signatureVersion = body.SignatureVersion as string | undefined;

  if (!certUrl || !signature) {
    throw new Error('Missing SigningCertURL or Signature in SNS payload');
  }

  if (!SNS_CERT_URL_PATTERN.test(certUrl)) {
    throw new Error(`Untrusted SNS certificate URL: ${certUrl}`);
  }

  const cert = await httpsGetBody(certUrl);
  const message = buildSnsStringToSign(body);

  // SignatureVersion 2 is SHA256withRSA (crypto name: sha256)
  // SignatureVersion 1 is SHA1withRSA (crypto name: sha1)
  const algorithm = signatureVersion === '2' ? 'sha256' : 'sha1';
  const verify = crypto.createVerify(algorithm);
  verify.update(message);

  if (!verify.verify(cert, signature, 'base64')) {
    throw new Error('SNS signature mismatch — payload may have been tampered with');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SNS Webhook — Subscription Confirmation and Email Event Processing
// Route: POST /internal/sns
// ─────────────────────────────────────────────────────────────────────────────

async function resolveJobAndTenant(
  recipientEmail: string,
  sesEvent: Record<string, any>
): Promise<{ jobId: string; tenantId: string } | null> {
  const mail = sesEvent.mail as Record<string, any> | undefined;
  const tags = mail?.tags as Record<string, string[]> | undefined;

  let tenantId = tags?.tenant_id?.[0] || tags?.tenantId?.[0];
  let jobId = tags?.job_id?.[0] || tags?.jobId?.[0];

  if (jobId && tenantId) {
    return { jobId, tenantId };
  }

  // Fallback to DB lookup
  const { data: matchedJob } = await supabaseAdmin
    .from('email_jobs')
    .select('job_id, tenant_id')
    .eq('to_email', recipientEmail)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (matchedJob) {
    return { jobId: matchedJob.job_id, tenantId: matchedJob.tenant_id };
  }

  return null;
}

internalRouter.post('/sns', async (request, response) => {
  try {
    const raw = request.body;

    // SNS sends Content-Type: text/plain — body will be a string.
    let body: Record<string, unknown>;

    if (typeof raw === 'string') {
      try {
        body = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        console.error('[SNS] Failed to parse raw body as JSON:', raw);
        response.status(400).json({ error: 'Invalid JSON' });
        return;
      }
    } else {
      body = raw as Record<string, unknown>;
    }

    console.log('[SNS] Received message type:', body?.Type);

    // ── Verify SNS signature (P2 security) ───────────────────────────────────
    try {
      await verifySnsSignature(body);
    } catch (err) {
      console.error('[SNS] Signature verification failed:', err instanceof Error ? err.message : err);
      response.status(403).json({ error: 'Invalid SNS signature' });
      return;
    }

    // ── Case 1: SubscriptionConfirmation ─────────────────────────────────────
    if (body.Type === 'SubscriptionConfirmation') {
      const subscribeUrl = body.SubscribeURL as string | undefined;
      if (!subscribeUrl) {
        console.error('[SNS] Missing SubscribeURL in SubscriptionConfirmation');
        response.status(400).json({ error: 'Missing SubscribeURL' });
        return;
      }

      try {
        // Properly await the confirmation call (was fire-and-forget before).
        await httpsGetBody(subscribeUrl);
        console.log('[SNS] Subscription confirmed successfully');
        response.status(200).json({ ok: true });
      } catch (err) {
        console.error('[SNS] Error confirming subscription:', err instanceof Error ? err.message : err);
        response.status(500).json({ error: 'Failed to confirm subscription' });
      }
      return;
    }

    // ── Case 2: Notification (SES events) ────────────────────────────────────
    if (body.Type === 'Notification') {
      // IMPORTANT: Always return 200 for Notification — if we return 5xx,
      // SNS will retry the same event up to 23 times over 23 days.
      // Process first, then respond; any internal error is logged only.
      try {
        const messageStr = body.Message as string | undefined;
        if (!messageStr) {
          console.error('[SNS] Missing Message field in Notification');
          response.status(200).json({ ok: true });
          return;
        }

        const sesEvent = JSON.parse(messageStr) as Record<string, unknown>;
        const notificationType = sesEvent.notificationType as string | undefined;

        console.log('[SNS] SES notification type:', notificationType);

        // ── Bounce ────────────────────────────────────────────────────────────
        if (notificationType === 'Bounce') {
          const bounce = sesEvent.bounce as Record<string, unknown> | undefined;
          const bounceType = (bounce?.bounceType as string | undefined)?.toLowerCase() ?? 'unknown';
          const bouncedRecipients = bounce?.bouncedRecipients as Array<Record<string, unknown>> | undefined;

          if (bouncedRecipients?.length) {
            const emails = bouncedRecipients
              .map((r) => r.emailAddress as string)
              .filter(Boolean);

            if (bounceType === 'permanent') {
              console.log('[SNS] Hard bounce — suppressing:', emails);

              // tenant_id is NULL = platform-level suppression (affects all tenants).
              // For per-tenant suppression, pass tenant_id as an SES message tag
              // in the Go worker and read it from sesEvent.mail.tags here.
              const { error } = await supabaseAdmin
                .from('suppressed')
                .insert(emails.map((email) => ({ tenant_id: null, email, reason: 'bounce' })));

              if (error && error.code !== '23505') {
                console.error('[SNS] Failed to insert bounce suppressions:', error);
              }
            } else {
              console.log(`[SNS] Soft/transient bounce (${bounceType}) — not suppressing`);
            }

            // Log event in email_job_events
            for (const email of emails) {
              const resolved = await resolveJobAndTenant(email, sesEvent);
              if (resolved) {
                await supabaseAdmin
                  .from('email_job_events')
                  .insert({
                    job_id: resolved.jobId,
                    tenant_id: resolved.tenantId,
                    event_type: 'bounced',
                    metadata: { bounceType, email }
                  });
              }
            }
          }
        }

        // ── Complaint ─────────────────────────────────────────────────────────
        if (notificationType === 'Complaint') {
          const complaint = sesEvent.complaint as Record<string, unknown> | undefined;
          const complainedRecipients = complaint?.complainedRecipients as Array<Record<string, unknown>> | undefined;
          const complaintFeedbackType = complaint?.complaintFeedbackType as string | undefined;

          if (complainedRecipients?.length) {
            const emails = complainedRecipients
              .map((r) => r.emailAddress as string)
              .filter(Boolean);

            console.log('[SNS] Complaint — suppressing:', emails);

            const { error } = await supabaseAdmin
              .from('suppressed')
              .insert(emails.map((email) => ({ tenant_id: null, email, reason: 'complaint' })));

            if (error && error.code !== '23505') {
              console.error('[SNS] Failed to insert complaint suppressions:', error);
            }

            // Log event in email_job_events
            for (const email of emails) {
              const resolved = await resolveJobAndTenant(email, sesEvent);
              if (resolved) {
                await supabaseAdmin
                  .from('email_job_events')
                  .insert({
                    job_id: resolved.jobId,
                    tenant_id: resolved.tenantId,
                    event_type: 'complained',
                    metadata: { complaintFeedbackType, email }
                  });
              }
            }
          }
        }

        // ── Delivery ──────────────────────────────────────────────────────────
        if (notificationType === 'Delivery') {
          const delivery = sesEvent.delivery as Record<string, unknown> | undefined;
          const recipients = delivery?.recipients as Array<string> | undefined;
          if (recipients?.length) {
            console.log('[SNS] Delivery confirmed for:', recipients);
            for (const email of recipients) {
              const resolved = await resolveJobAndTenant(email, sesEvent);
              if (resolved) {
                const now = new Date().toISOString();
                await Promise.all([
                  supabaseAdmin
                    .from('email_jobs')
                    .update({ status: 'delivered', delivered_at: now, sent_at: now })
                    .eq('job_id', resolved.jobId),
                  supabaseAdmin
                    .from('email_job_events')
                    .insert({
                      job_id: resolved.jobId,
                      tenant_id: resolved.tenantId,
                      event_type: 'delivered',
                      metadata: { email }
                    })
                ]);
              }
            }
          }
        }

        // ── Send ──────────────────────────────────────────────────────────────
        if (notificationType === 'Send') {
          console.log('[SNS] Send event received');
        }

      } catch (err) {
        // Log but never propagate — response must be 200 for Notification.
        console.error('[SNS] Error processing notification:', err instanceof Error ? err.message : err);
      }

      response.status(200).json({ ok: true });
      return;
    }

    // ── Unknown message type — accept gracefully to avoid SNS retry storms ───
    console.warn('[SNS] Unknown message type:', body.Type);
    response.status(200).json({ ok: true });

  } catch (err) {
    console.error('[SNS] Fatal error:', err instanceof Error ? err.message : err);
    response.status(500).json({ error: 'Internal server error' });
  }
});
