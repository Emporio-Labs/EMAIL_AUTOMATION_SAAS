import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/require-auth';
import { requireTenant } from '../middleware/require-tenant';
import { supabaseAdmin } from '../lib/supabase';

export const analyticsRouter = Router();

const rangeSchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
});

function buildDateBuckets(days: number) {
  const buckets = new Map<string, number>();
  const start = new Date();

  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));

  for (let i = 0; i < days; i += 1) {
    const current = new Date(start);
    current.setUTCDate(start.getUTCDate() + i);
    buckets.set(current.toISOString().slice(0, 10), 0);
  }

  return { start, buckets };
}

analyticsRouter.use(requireAuth, requireTenant);

analyticsRouter.get('/overview', async (request, response) => {
  const parsed = rangeSchema.safeParse(request.query);

  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid query', issues: parsed.error.flatten() });
    return;
  }

  const tenantId = request.tenant?.id;
  const { start, buckets } = buildDateBuckets(parsed.data.days);

  const { data: jobs, error: jobsError } = await supabaseAdmin
    .from('email_jobs')
    .select('status, created_at')
    .eq('tenant_id', tenantId as string)
    .gte('created_at', start.toISOString());

  if (jobsError) {
    response.status(500).json({ error: 'Failed to load email jobs' });
    return;
  }

  const statusBreakdown = {
    queued: 0,
    delivered: 0,
    failed: 0,
  };

  for (const job of jobs ?? []) {
    const status = (job.status ?? '').toLowerCase();
    if (status === 'queued') {
      statusBreakdown.queued += 1;
    } else if (status === 'delivered') {
      statusBreakdown.delivered += 1;
    } else if (status === 'failed') {
      statusBreakdown.failed += 1;
    }

    const createdAt = job.created_at ? job.created_at.slice(0, 10) : null;
    if (createdAt && buckets.has(createdAt)) {
      buckets.set(createdAt, (buckets.get(createdAt) ?? 0) + 1);
    }
  }

  const { data: suppressed, error: suppressedError } = await supabaseAdmin
    .from('suppressed')
    .select('reason, created_at')
    .eq('tenant_id', tenantId as string)
    .gte('created_at', start.toISOString());

  if (suppressedError) {
    response.status(500).json({ error: 'Failed to load suppression data' });
    return;
  }

  let bounceCount = 0;
  let complaintCount = 0;

  for (const item of suppressed ?? []) {
    const reason = (item.reason ?? '').toLowerCase();
    if (reason === 'bounce') {
      bounceCount += 1;
    } else if (reason === 'complaint') {
      complaintCount += 1;
    }
  }

  const totalSent = jobs?.length ?? 0;
  const bounceRate = totalSent > 0 ? bounceCount / totalSent : 0;
  const complaintRate = totalSent > 0 ? complaintCount / totalSent : 0;

  const { data: recentJobs, error: recentError } = await supabaseAdmin
    .from('email_jobs')
    .select('job_id, to_email, subject, status, created_at, sent_at, failed_at')
    .eq('tenant_id', tenantId as string)
    .order('created_at', { ascending: false })
    .limit(20);

  if (recentError) {
    response.status(500).json({ error: 'Failed to load recent activity' });
    return;
  }

  const volume = Array.from(buckets.entries()).map(([date, total]) => ({
    date,
    total,
  }));

  response.json({
    rangeDays: parsed.data.days,
    totals: {
      sent: totalSent,
      ...statusBreakdown,
    },
    volume,
    suppression: {
      bounceCount,
      complaintCount,
      bounceRate,
      complaintRate,
    },
    recent: recentJobs ?? [],
  });
});
