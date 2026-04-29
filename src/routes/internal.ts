import { Router } from 'express';
import { z } from 'zod';
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
