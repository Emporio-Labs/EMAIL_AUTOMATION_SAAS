import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/require-auth';
import { requireTenant } from '../middleware/require-tenant';
import { supabaseAdmin } from '../lib/supabase';
import { normalizeEmail } from '../utils/normalize-email';
import { PLAN_LIMITS, resolvePlanLimit, PlanName } from '../config/plans';

export const sendingAddressesRouter = Router();

const createSchema = z.object({
  address: z.string().trim().email(),
  label: z.string().trim().max(120).optional(),
});

const updateSchema = z.object({
  address: z.string().trim().email().optional(),
  label: z.string().trim().max(120).optional(),
});

sendingAddressesRouter.use(requireAuth, requireTenant);

sendingAddressesRouter.get('/', async (request, response) => {
  const tenantId = request.tenant!.id;

  const { data, error } = await supabaseAdmin
    .from('sending_addresses')
    .select('id, address, label, domain_id, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });

  if (error) {
    response.status(500).json({ error: 'Failed to load sending addresses' });
    return;
  }

  response.json({ addresses: data ?? [] });
});

sendingAddressesRouter.post('/', async (request, response) => {
  const parsed = createSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
    return;
  }

  const tenantId = request.tenant!.id;
  const planName = (request.tenant?.plan || 'free') as PlanName;
  const planLimits = PLAN_LIMITS[planName];
  const limit = resolvePlanLimit(request.tenant?.max_sending_addresses, planLimits.max_sending_addresses);

  if (limit !== null) {
    const { count, error: countError } = await supabaseAdmin
      .from('sending_addresses')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId);

    if (countError) {
      response.status(500).json({ error: 'Failed to verify sending address limit' });
      return;
    }

    if ((count ?? 0) >= limit) {
      response.status(403).json({ error: 'Sending address limit reached. Upgrade your plan to add more.' });
      return;
    }
  }

  const address = normalizeEmail(parsed.data.address);
  const domain = address.split('@')[1]?.toLowerCase();

  if (!domain) {
    response.status(400).json({ error: 'Invalid address' });
    return;
  }

  const { data: domainRow, error: domainError } = await supabaseAdmin
    .from('domains')
    .select('id, verified')
    .eq('tenant_id', tenantId)
    .eq('domain', domain)
    .maybeSingle();

  if (domainError) {
    response.status(500).json({ error: 'Failed to check sending domain' });
    return;
  }

  if (!domainRow) {
    response.status(403).json({
      error: `Domain "${domain}" is not registered for this tenant.`,
      hint: 'Add it at POST /v1/domains and verify before adding addresses.',
    });
    return;
  }

  if (!domainRow.verified) {
    response.status(403).json({
      error: `Domain "${domain}" is registered but not yet verified.`,
      hint: `Publish the CNAME records and call GET /v1/domains/${domainRow.id}/verify.`,
    });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from('sending_addresses')
    .insert({
      tenant_id: tenantId,
      domain_id: domainRow.id,
      address,
      label: parsed.data.label ?? null,
    })
    .select('id, address, label, domain_id, created_at')
    .single();

  if (error || !data) {
    if (error?.code === '23505') {
      response.status(409).json({ error: 'Address already registered for this tenant' });
      return;
    }
    response.status(500).json({ error: 'Failed to save sending address' });
    return;
  }

  response.status(201).json({ address: data });
});

sendingAddressesRouter.patch('/:id', async (request, response) => {
  const parsed = updateSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
    return;
  }

  if (parsed.data.address === undefined && parsed.data.label === undefined) {
    response.status(400).json({ error: 'Provide address and/or label to update' });
    return;
  }

  const tenantId = request.tenant!.id;

  const { data: existing, error: fetchError } = await supabaseAdmin
    .from('sending_addresses')
    .select('id, address, label, domain_id, created_at')
    .eq('tenant_id', tenantId)
    .eq('id', request.params.id)
    .maybeSingle();

  if (fetchError) {
    response.status(500).json({ error: 'Failed to load sending address' });
    return;
  }

  if (!existing) {
    response.status(404).json({ error: 'Sending address not found' });
    return;
  }

  const updatePayload: Record<string, string | null> = {};

  if (parsed.data.label !== undefined) {
    const label = parsed.data.label.trim();
    updatePayload.label = label.length > 0 ? label : null;
  }

  if (parsed.data.address !== undefined) {
    const address = normalizeEmail(parsed.data.address);
    const domain = address.split('@')[1]?.toLowerCase();

    if (!domain) {
      response.status(400).json({ error: 'Invalid address' });
      return;
    }

    const { data: domainRow, error: domainError } = await supabaseAdmin
      .from('domains')
      .select('id, verified')
      .eq('tenant_id', tenantId)
      .eq('domain', domain)
      .maybeSingle();

    if (domainError) {
      response.status(500).json({ error: 'Failed to check sending domain' });
      return;
    }

    if (!domainRow) {
      response.status(403).json({
        error: `Domain "${domain}" is not registered for this tenant.`,
        hint: 'Add it at POST /v1/domains and verify before adding addresses.',
      });
      return;
    }

    if (!domainRow.verified) {
      response.status(403).json({
        error: `Domain "${domain}" is registered but not yet verified.`,
        hint: `Publish the CNAME records and call GET /v1/domains/${domainRow.id}/verify.`,
      });
      return;
    }

    updatePayload.address = address;
    updatePayload.domain_id = domainRow.id;
  }

  const { data, error } = await supabaseAdmin
    .from('sending_addresses')
    .update(updatePayload)
    .eq('tenant_id', tenantId)
    .eq('id', request.params.id)
    .select('id, address, label, domain_id, created_at')
    .maybeSingle();

  if (error) {
    if (error.code === '23505') {
      response.status(409).json({ error: 'Address already registered for this tenant' });
      return;
    }
    response.status(500).json({ error: 'Failed to update sending address' });
    return;
  }

  if (!data) {
    response.status(404).json({ error: 'Sending address not found' });
    return;
  }

  response.json({ address: data });
});

sendingAddressesRouter.delete('/:id', async (request, response) => {
  const tenantId = request.tenant!.id;

  const { error } = await supabaseAdmin
    .from('sending_addresses')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('id', request.params.id);

  if (error) {
    response.status(500).json({ error: 'Failed to delete sending address' });
    return;
  }

  response.status(204).send();
});
