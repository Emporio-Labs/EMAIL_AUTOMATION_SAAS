import { randomUUID } from 'crypto';
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import { requireAuth } from '../middleware/require-auth';
import { requireTenant } from '../middleware/require-tenant';
import { supabaseAdmin } from '../lib/supabase';
import { normalizeEmail } from '../utils/normalize-email';

export const campaignsRouter = Router();

const campaignSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  contacts: z.array(
    z.object({
      email: z.string().trim().email(),
      source: z.enum(['list', 'manual']),
    }),
  ).min(1),
  status: z.enum(['draft', 'scheduled', 'running', 'paused', 'completed']).default('draft'),
});

const campaignStatusSchema = z.object({
  status: z.enum(['draft', 'scheduled', 'running', 'paused', 'completed']),
});

campaignsRouter.use(requireAuth, requireTenant);

campaignsRouter.get('/', async (request, response) => {
  const tenantId = request.tenant?.id;

  const { data, error } = await supabaseAdmin
    .from('campaigns')
    .select('id, tenant_id, name, description, status, created_at, updated_at')
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
      status: parsed.data.status,
    })
    .select('id, tenant_id, name, description, status, created_at, updated_at')
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
    .select('id, tenant_id, name, description, status, created_at, updated_at')
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

campaignsRouter.patch('/:campaignId/status', async (request, response) => {
  const parsed = campaignStatusSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
    return;
  }

  const tenantId = request.tenant?.id;

  const { data, error } = await supabaseAdmin
    .from('campaigns')
    .update({
      status: parsed.data.status,
      updated_at: new Date().toISOString(),
    })
    .eq('tenant_id', tenantId as string)
    .eq('id', request.params.campaignId)
    .select('id, tenant_id, name, description, status, created_at, updated_at')
    .maybeSingle();

  if (error) {
    response.status(500).json({ error: 'Failed to update campaign status' });
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