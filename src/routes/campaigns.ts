import { randomUUID } from 'crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import { requireAuth } from '../middleware/require-auth';
import { requireTenant } from '../middleware/require-tenant';
import { supabaseAdmin } from '../lib/supabase';
import { normalizeEmail } from '../utils/normalize-email';

export const campaignsRouter = Router();

const CAMPAIGN_COLUMNS = 'id, tenant_id, name, description, status, subject, html, from_email, scheduled_at, started_at, completed_at, last_error, created_at, updated_at';

const CAMPAIGN_LIST_COLUMNS = 'id, tenant_id, name, description, status, subject, scheduled_at, started_at, completed_at, last_error, created_at, updated_at';

const MAX_HTML_BYTES = 200 * 1024;
const contentFields = {
  subject: z.string().trim().min(1).max(200),
  html: z.string().trim().min(1).refine((v) => Buffer.byteLength(v, 'utf8') <= MAX_HTML_BYTES, {
    message: `html must be at most ${MAX_HTML_BYTES / 1024} KB`,
  }),
  fromEmail: z.string().trim().email(),
};
const futureDate = z.string().datetime({ offset: true }).refine((v) => new Date(v).getTime() > Date.now() - 60_000, {
  message: 'scheduledAt must be in the future',
});

const campaignSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  subject: contentFields.subject.optional(),
  html: contentFields.html.optional(),
  fromEmail: contentFields.fromEmail.optional(),
  scheduledAt: futureDate.optional(),
  contacts: z.array(
    z.object({
      email: z.string().trim().email(),
      source: z.enum(['list', 'manual']),
    }),
  ).min(1),
  // Kept for older dashboard builds; new campaigns start as draft or scheduled.
  status: z.enum(['draft', 'scheduled', 'running', 'paused', 'completed']).optional(),
});

const campaignStatusSchema = z.object({
  status: z.enum(['draft', 'scheduled', 'running', 'paused', 'completed']),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  subject: contentFields.subject.optional(),
  html: contentFields.html.optional(),
  fromEmail: contentFields.fromEmail.optional(),
}).refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

const scheduleSchema = z.object({ scheduledAt: futureDate });

campaignsRouter.use(requireAuth, requireTenant);

campaignsRouter.get('/', async (request, response) => {
  const tenantId = request.tenant?.id;

  const { data, error } = await supabaseAdmin
    .from('campaigns')
    .select(CAMPAIGN_LIST_COLUMNS)
    .eq('tenant_id', tenantId as string)
    .order('created_at', { ascending: false });

  if (error) {
    if (env.AUTH_BYPASS) {
      response.json({ campaigns: [] });
      return;
    }

    response.status(500).json({ error: 'Failed to load campaigns' });
    return;
  }

  const campaignIds = (data ?? []).map((campaign) => campaign.id);
  let contactsByCampaignId = new Map<string, number>();

  if (campaignIds.length > 0) {
    const { data: contactsData } = await supabaseAdmin
      .from('campaign_contacts')
      .select('campaign_id')
      .in('campaign_id', campaignIds);

    contactsByCampaignId = (contactsData ?? []).reduce((acc, row) => {
      acc.set(row.campaign_id, (acc.get(row.campaign_id) ?? 0) + 1);
      return acc;
    }, new Map<string, number>());
  }

  response.json({
    campaigns: (data ?? []).map((campaign) => ({
      ...campaign,
      contacts_count: contactsByCampaignId.get(campaign.id) ?? 0,
    })),
  });
});

campaignsRouter.post('/', async (request, response) => {
  const rawBody = typeof request.body === 'string'
    ? (() => {
        try {
          return JSON.parse(request.body);
        } catch {
          return request.body;
        }
      })()
    : request.body;

  const parsed = campaignSchema.safeParse(rawBody);

  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
    return;
  }

  const tenantId = request.tenant?.id;

  const dedupedContacts = Array.from(
    parsed.data.contacts.reduce((acc, contact) => {
      const email = normalizeEmail(contact.email);
      if (!acc.has(email)) {
        acc.set(email, contact.source);
      }
      return acc;
    }, new Map<string, 'list' | 'manual'>()),
  ).map(([email, source]) => ({ email, source }));

  if (dedupedContacts.length === 0) {
    response.status(400).json({ error: 'No valid contacts provided' });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from('campaigns')
    .insert({
      tenant_id: tenantId as string,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      subject: parsed.data.subject ?? null,
      html: parsed.data.html ?? null,
      from_email: parsed.data.fromEmail ? normalizeEmail(parsed.data.fromEmail) : null,
      scheduled_at: parsed.data.scheduledAt ?? null,
      // Only a campaign with content and a time can start out scheduled.
      status: parsed.data.scheduledAt && parsed.data.subject && parsed.data.html && parsed.data.fromEmail
        ? 'scheduled'
        : 'draft',
    })
    .select(CAMPAIGN_COLUMNS)
    .single();

  if (error || !data) {
    if (env.AUTH_BYPASS) {
      response.status(201).json({
        campaign: {
          id: randomUUID(),
          tenant_id: tenantId,
          name: parsed.data.name,
          description: parsed.data.description ?? null,
          status: parsed.data.status,
          contacts_count: dedupedContacts.length,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      });
      return;
    }

    response.status(500).json({ error: 'Failed to create campaign' });
    return;
  }

  const contactRows = dedupedContacts.map((contact) => ({
    tenant_id: tenantId as string,
    email: contact.email,
    updated_at: new Date().toISOString(),
  }));

  const { error: contactsError } = await supabaseAdmin
    .from('contacts')
    .upsert(contactRows, { onConflict: 'tenant_id,email' });

  if (contactsError && !env.AUTH_BYPASS) {
    response.status(500).json({ error: 'Failed to prepare campaign contacts' });
    return;
  }

  const { error: campaignContactsError } = await supabaseAdmin
    .from('campaign_contacts')
    .insert(
      dedupedContacts.map((contact) => ({
        campaign_id: data.id,
        email: contact.email,
        source_type: contact.source,
      })),
    );

  if (campaignContactsError && !env.AUTH_BYPASS) {
    response.status(500).json({ error: 'Failed to save campaign recipients' });
    return;
  }

  response.status(201).json({
    campaign: {
      ...data,
      contacts_count: dedupedContacts.length,
    },
  });
});

campaignsRouter.get('/:campaignId', async (request, response) => {
  const tenantId = request.tenant?.id;

  const { data, error } = await supabaseAdmin
    .from('campaigns')
    .select(CAMPAIGN_COLUMNS)
    .eq('tenant_id', tenantId as string)
    .eq('id', request.params.campaignId)
    .maybeSingle();

  if (error) {
    response.status(500).json({ error: 'Failed to load campaign' });
    return;
  }

  if (!data) {
    response.status(404).json({ error: 'Campaign not found' });
    return;
  }

  const { count } = await supabaseAdmin
    .from('campaign_contacts')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', request.params.campaignId);

  response.json({ campaign: { ...data, contacts_count: count ?? 0 } });
});

type CampaignStatus = 'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'failed';
type CampaignAction = 'schedule' | 'send-now' | 'pause' | 'resume' | 'cancel';

// Which statuses each action may start from.
const ALLOWED_FROM: Record<CampaignAction, CampaignStatus[]> = {
  schedule: ['draft', 'scheduled', 'failed'],
  'send-now': ['draft', 'scheduled', 'failed'],
  pause: ['scheduled', 'running'],
  resume: ['paused'],
  cancel: ['scheduled'],
};

async function respondWithCampaign(response: Response, tenantId: string, campaignId: string, status = 200) {
  const [{ data }, { count }] = await Promise.all([
    supabaseAdmin.from('campaigns').select(CAMPAIGN_COLUMNS).eq('tenant_id', tenantId).eq('id', campaignId).maybeSingle(),
    supabaseAdmin.from('campaign_contacts').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId),
  ]);
  if (!data) {
    response.status(404).json({ error: 'Campaign not found' });
    return;
  }
  response.status(status).json({ campaign: { ...data, contacts_count: count ?? 0 } });
}

async function applyAction(
  request: Request,
  response: Response,
  action: CampaignAction,
  scheduledAt?: string,
): Promise<void> {
  const tenantId = request.tenant!.id;
  const campaignId = request.params.campaignId as string;

  const { data: campaign, error } = await supabaseAdmin
    .from('campaigns')
    .select('id, status, subject, html, from_email, started_at')
    .eq('tenant_id', tenantId)
    .eq('id', campaignId)
    .maybeSingle();

  if (error) {
    response.status(500).json({ error: 'Failed to load campaign' });
    return;
  }
  if (!campaign) {
    response.status(404).json({ error: 'Campaign not found' });
    return;
  }

  const current = campaign.status as CampaignStatus;
  if (!ALLOWED_FROM[action].includes(current)) {
    response.status(409).json({ error: `Cannot ${action.replace('-', ' ')} a ${current} campaign` });
    return;
  }

  if ((action === 'schedule' || action === 'send-now' || action === 'resume')
    && (!campaign.subject || !campaign.html || !campaign.from_email)) {
    response.status(422).json({ error: 'Add a subject, content and From address before sending' });
    return;
  }

  const now = new Date().toISOString();
  const updates: Record<CampaignAction, Record<string, unknown>> = {
    schedule: { status: 'scheduled', scheduled_at: scheduledAt, last_error: null },
    // The scheduler picks it up on its next tick (within ~15 s).
    'send-now': { status: 'scheduled', scheduled_at: now, last_error: null },
    pause: { status: 'paused' },
    // A campaign paused before it ever started goes back to its schedule.
    resume: campaign.started_at ? { status: 'running', last_error: null } : { status: 'scheduled', last_error: null },
    cancel: { status: 'draft', scheduled_at: null },
  };

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('campaigns')
    .update({ ...updates[action], updated_at: now })
    .eq('tenant_id', tenantId)
    .eq('id', campaignId)
    .eq('status', current) // lost the race with the scheduler → 409 below
    .select('id')
    .maybeSingle();

  if (updateError) {
    response.status(500).json({ error: 'Failed to update campaign' });
    return;
  }
  if (!updated) {
    response.status(409).json({ error: 'Campaign changed while updating; reload and try again' });
    return;
  }

  await respondWithCampaign(response, tenantId, campaignId);
}

campaignsRouter.patch('/:campaignId', async (request, response) => {
  const parsed = updateSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
    return;
  }
  const tenantId = request.tenant!.id;

  const fields: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.name !== undefined) fields.name = parsed.data.name;
  if (parsed.data.description !== undefined) fields.description = parsed.data.description;
  if (parsed.data.subject !== undefined) fields.subject = parsed.data.subject;
  if (parsed.data.html !== undefined) fields.html = parsed.data.html;
  if (parsed.data.fromEmail !== undefined) fields.from_email = normalizeEmail(parsed.data.fromEmail);

  // Content is frozen once sending has started.
  const { data, error } = await supabaseAdmin
    .from('campaigns')
    .update(fields)
    .eq('tenant_id', tenantId)
    .eq('id', request.params.campaignId)
    .in('status', ['draft', 'scheduled', 'failed'])
    .select('id')
    .maybeSingle();

  if (error) {
    response.status(error.code === '23505' ? 409 : 500).json({
      error: error.code === '23505' ? 'A campaign with this name already exists' : 'Failed to update campaign',
    });
    return;
  }
  if (!data) {
    response.status(409).json({ error: 'Campaign not found, or already sending (pause it is not enough; content is locked once started)' });
    return;
  }
  await respondWithCampaign(response, tenantId, request.params.campaignId);
});

campaignsRouter.post('/:campaignId/schedule', async (request, response) => {
  const parsed = scheduleSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
    return;
  }
  await applyAction(request, response, 'schedule', new Date(parsed.data.scheduledAt).toISOString());
});
campaignsRouter.post('/:campaignId/send-now', (request, response) => applyAction(request, response, 'send-now'));
campaignsRouter.post('/:campaignId/pause', (request, response) => applyAction(request, response, 'pause'));
campaignsRouter.post('/:campaignId/resume', (request, response) => applyAction(request, response, 'resume'));
campaignsRouter.post('/:campaignId/cancel', (request, response) => applyAction(request, response, 'cancel'));

// Older dashboard builds change status directly; map that onto the actions.
campaignsRouter.patch('/:campaignId/status', async (request, response) => {
  const parsed = campaignStatusSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
    return;
  }
  const action: Partial<Record<CampaignStatus, CampaignAction>> = {
    running: 'resume',
    paused: 'pause',
    draft: 'cancel',
  };
  const mapped = action[parsed.data.status];
  if (!mapped) {
    response.status(400).json({ error: 'Use POST /schedule or /send-now to start a campaign' });
    return;
  }
  await applyAction(request, response, mapped);
});

campaignsRouter.get('/:campaignId/stats', async (request, response) => {
  const tenantId = request.tenant!.id;
  const campaignId = request.params.campaignId as string;

  const { data: campaign } = await supabaseAdmin
    .from('campaigns')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('id', campaignId)
    .maybeSingle();
  if (!campaign) {
    response.status(404).json({ error: 'Campaign not found' });
    return;
  }

  const countJobs = (filter: (q: any) => any) =>
    filter(
      supabaseAdmin
        .from('email_jobs')
        .select('job_id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('campaign_id', campaignId),
    ).then((r: { count: number | null }) => r.count ?? 0);
  const countContacts = (filter: (q: any) => any) =>
    filter(
      supabaseAdmin
        .from('campaign_contacts')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaignId),
    ).then((r: { count: number | null }) => r.count ?? 0);

  const [recipients, pending, skipped, sent, delivered, failed, bounced, complained, opened, clicked] =
    await Promise.all([
      countContacts((q) => q),
      countContacts((q) => q.is('processed_at', null)),
      countContacts((q) => q.not('skipped_reason', 'is', null)),
      countJobs((q) => q),
      countJobs((q) => q.in('status', ['delivered', 'bounced', 'complained'])),
      countJobs((q) => q.eq('status', 'failed')),
      countJobs((q) => q.eq('status', 'bounced')),
      countJobs((q) => q.eq('status', 'complained')),
      countJobs((q) => q.not('opened_at', 'is', null)),
      countJobs((q) => q.not('clicked_at', 'is', null)),
    ]);

  const rate = (n: number) => (sent > 0 ? Math.round((n / sent) * 1000) / 10 : 0);
  response.json({
    stats: {
      recipients,
      pending,
      skipped,
      sent,
      delivered,
      failed,
      bounced,
      complained,
      opened,
      clicked,
      rates: {
        delivered: rate(delivered),
        opened: rate(opened),
        clicked: rate(clicked),
        bounced: rate(bounced),
      },
    },
  });
});

campaignsRouter.delete('/:campaignId', async (request, response) => {
  const tenantId = request.tenant?.id;

  const { error } = await supabaseAdmin
    .from('campaigns')
    .delete()
    .eq('tenant_id', tenantId as string)
    .eq('id', request.params.campaignId);

  if (error) {
    response.status(500).json({ error: 'Failed to delete campaign' });
    return;
  }

  response.status(204).send();
});

campaignsRouter.get('/:campaignId/contacts', async (request, response) => {
  const tenantId = request.tenant?.id;

  const { data: campaign, error: campaignError } = await supabaseAdmin
    .from('campaigns')
    .select('id')
    .eq('tenant_id', tenantId as string)
    .eq('id', request.params.campaignId)
    .maybeSingle();

  if (campaignError) {
    response.status(500).json({ error: 'Failed to load campaign recipients' });
    return;
  }

  if (!campaign) {
    response.status(404).json({ error: 'Campaign not found' });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from('campaign_contacts')
    .select('id, campaign_id, email, source_type, created_at')
    .eq('campaign_id', request.params.campaignId)
    .order('created_at', { ascending: false });

  if (error) {
    response.status(500).json({ error: 'Failed to load campaign recipients' });
    return;
  }

  const emails = (data ?? []).map((row) => row.email);
  const { data: subscribedRows } = emails.length > 0
    ? await supabaseAdmin
        .from('contacts')
        .select('email, is_subscribed')
        .eq('tenant_id', tenantId as string)
        .in('email', emails)
    : { data: [] };

  const subscribedMap = new Map((subscribedRows ?? []).map((row) => [row.email, row.is_subscribed]));

  response.json({
    contacts: (data ?? []).map((row) => ({
      ...row,
      is_subscribed: subscribedMap.get(row.email) ?? true,
    })),
  });
});

campaignsRouter.get('/:campaignId/history', async (request, response) => {
  const tenantId = request.tenant?.id;

  const { data: campaign, error: campaignError } = await supabaseAdmin
    .from('campaigns')
    .select('id, created_at')
    .eq('tenant_id', tenantId as string)
    .eq('id', request.params.campaignId)
    .maybeSingle();

  if (campaignError) {
    response.status(500).json({ error: 'Failed to load campaign for history' });
    return;
  }

  if (!campaign) {
    response.status(404).json({ error: 'Campaign not found' });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from('email_jobs')
    .select('job_id, from_email, to_email, subject, status, email_type, created_at, sent_at, failed_at, failure_reason')
    .eq('tenant_id', tenantId as string)
    .eq('campaign_id', request.params.campaignId)
    .order('created_at', { ascending: false });

  if (error) {
    response.status(500).json({ error: 'Failed to load campaign history' });
    return;
  }

  response.json({ items: data ?? [] });
});

campaignsRouter.get('/:campaignId/suppression', async (request, response) => {
  const tenantId = request.tenant?.id;

  const { data, error } = await supabaseAdmin
    .from('suppressed')
    .select('id, email, reason, created_at')
    .eq('tenant_id', tenantId as string)
    .order('created_at', { ascending: false });

  if (error) {
    response.status(500).json({ error: 'Failed to load campaign suppression' });
    return;
  }

  response.json({ items: data ?? [] });
});