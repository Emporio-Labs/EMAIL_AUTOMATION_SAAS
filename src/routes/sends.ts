import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/require-auth';
import { requireTenant } from '../middleware/require-tenant';
import { supabaseAdmin } from '../lib/supabase';

export const sendsRouter = Router();

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['queued', 'delivered', 'failed']).optional(),
  to: z.string().trim().min(1).optional(),
  from: z.string().trim().min(1).optional(),
  subject: z.string().trim().min(1).optional(),
  startDate: z.string().trim().optional(),
  endDate: z.string().trim().optional(),
});

sendsRouter.use(requireAuth, requireTenant);

sendsRouter.get('/', async (request, response) => {
  const parsed = querySchema.safeParse(request.query);

  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid query', issues: parsed.error.flatten() });
    return;
  }

  const tenantId = request.tenant?.id;
  const { page, limit, status, to, from, subject, startDate, endDate } = parsed.data;
  const offset = (page - 1) * limit;

  let query = supabaseAdmin
    .from('email_jobs')
    .select('job_id, from_email, to_email, subject, status, email_type, created_at, sent_at, failed_at', { count: 'exact' })
    .eq('tenant_id', tenantId as string);

  if (status) {
    query = query.eq('status', status);
  }

  if (to) {
    query = query.ilike('to_email', `%${to}%`);
  }

  if (from) {
    query = query.ilike('from_email', `%${from}%`);
  }

  if (subject) {
    query = query.ilike('subject', `%${subject}%`);
  }

  if (startDate) {
    const start = new Date(startDate);
    if (!Number.isNaN(start.valueOf())) {
      query = query.gte('created_at', start.toISOString());
    }
  }

  if (endDate) {
    const end = new Date(endDate);
    if (!Number.isNaN(end.valueOf())) {
      query = query.lte('created_at', end.toISOString());
    }
  }

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    response.status(500).json({ error: 'Failed to load sends' });
    return;
  }

  response.json({
    page,
    limit,
    total: count ?? 0,
    items: data ?? [],
  });
});
