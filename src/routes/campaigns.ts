import { randomUUID } from 'crypto';
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import { requireAuth } from '../middleware/require-auth';
import { requireTenant } from '../middleware/require-tenant';
import { supabaseAdmin } from '../lib/supabase';

export const campaignsRouter = Router();

const campaignSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  targetListId: z.string().uuid().optional().nullable(),
  optedOutListId: z.string().uuid().optional().nullable(),
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
    .select('id, tenant_id, name, description, status, target_list_id, opted_out_list_id, created_at, updated_at')
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

  response.json({ campaigns: data ?? [] });
});

campaignsRouter.post('/', async (request, response) => {
  const parsed = campaignSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
    return;
  }

  const tenantId = request.tenant?.id;

  // Validate that target list is 'marketing' type if provided
  if (parsed.data.targetListId) {
    const { data: targetList, error: listError } = await supabaseAdmin
      .from('lists')
      .select('id, type')
      .eq('tenant_id', tenantId as string)
      .eq('id', parsed.data.targetListId)
      .maybeSingle();

    if (listError || !targetList) {
      response.status(400).json({ error: 'Target list not found' });
      return;
    }

    if (targetList.type !== 'marketing') {
      response.status(400).json({ error: 'Target list must be of type "marketing"' });
      return;
    }
  }

  const { data, error } = await supabaseAdmin
    .from('campaigns')
    .insert({
      tenant_id: tenantId as string,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      status: parsed.data.status,
      target_list_id: parsed.data.targetListId ?? null,
      opted_out_list_id: parsed.data.optedOutListId ?? null,
    })
    .select('id, tenant_id, name, description, status, target_list_id, opted_out_list_id, created_at, updated_at')
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
          target_list_id: parsed.data.targetListId ?? null,
          opted_out_list_id: parsed.data.optedOutListId ?? null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      });
      return;
    }

    response.status(500).json({ error: 'Failed to create campaign' });
    return;
  }

  response.status(201).json({ campaign: data });
});

campaignsRouter.get('/:campaignId', async (request, response) => {
  const tenantId = request.tenant?.id;

  const { data, error } = await supabaseAdmin
    .from('campaigns')
    .select('id, tenant_id, name, description, status, target_list_id, opted_out_list_id, created_at, updated_at')
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

  response.json({ campaign: data });
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
    .select('id, tenant_id, name, description, status, target_list_id, opted_out_list_id, created_at, updated_at')
    .maybeSingle();

  if (error) {
    response.status(500).json({ error: 'Failed to update campaign status' });
    return;
  }

  if (!data) {
    response.status(404).json({ error: 'Campaign not found' });
    return;
  }

  response.json({ campaign: data });
});

campaignsRouter.get('/:campaignId/history', async (request, response) => {
  const tenantId = request.tenant?.id;

  const { data: campaign, error: campaignError } = await supabaseAdmin
    .from('campaigns')
    .select('id, target_list_id, created_at')
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

  if ((data?.length ?? 0) === 0 && campaign.target_list_id) {
    const { data: listContacts, error: listContactsError } = await supabaseAdmin
      .from('list_contacts')
      .select('contacts!inner(email)')
      .eq('list_id', campaign.target_list_id);

    if (!listContactsError) {
      const recipientEmails = Array.from(
        new Set(
          (listContacts ?? []).flatMap((row: any) => {
            const contacts = row.contacts;
            if (Array.isArray(contacts)) {
              return contacts.map((contact: { email: string }) => contact.email.toLowerCase());
            }

            if (contacts && typeof contacts === 'object' && 'email' in contacts) {
              return [(contacts as { email: string }).email.toLowerCase()];
            }

            return [];
          }),
        ),
      );

      if (recipientEmails.length > 0) {
        const { data: fallbackData, error: fallbackError } = await supabaseAdmin
          .from('email_jobs')
          .select('job_id, from_email, to_email, subject, status, email_type, created_at, sent_at, failed_at, failure_reason')
          .eq('tenant_id', tenantId as string)
          .eq('email_type', 'marketing')
          .in('to_email', recipientEmails)
          .gte('created_at', campaign.created_at)
          .order('created_at', { ascending: false });

        if (!fallbackError && (fallbackData?.length ?? 0) > 0) {
          response.json({ items: fallbackData, inferred: true });
          return;
        }
      }
    }
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