import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/require-auth';
import { requireTenant } from '../middleware/require-tenant';
import { supabaseAdmin } from '../lib/supabase';
import { sesRegisterDomain, sesGetDomainStatus, buildFullDnsRecords } from '../lib/ses';
import { PLAN_LIMITS, resolvePlanLimit, PlanName } from '../config/plans';

export const domainsRouter = Router();

// ── Validation ────────────────────────────────────────────────────────────────

const addDomainSchema = z.object({
  domain: z
    .string()
    .trim()
    .min(3)
    .regex(/^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,}$/i, 'Invalid domain format'),
});

// ── Auth guard ────────────────────────────────────────────────────────────────

domainsRouter.use(requireAuth, requireTenant);

// ── GET /v1/domains ───────────────────────────────────────────────────────────

domainsRouter.get('/', async (request, response) => {
  const tenantId = request.tenant!.id;

  const { data, error } = await supabaseAdmin
    .from('domains')
    .select('id, domain, verified, dkim_tokens, created_at, verified_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });

  if (error) {
    response.status(500).json({ error: 'Failed to load domains' });
    return;
  }

  response.json({ domains: data ?? [] });
});

// ── POST /v1/domains ──────────────────────────────────────────────────────────
// Register domain with SES → store tokens → return all 5 DNS records.

domainsRouter.post('/', async (request, response) => {
  const parsed = addDomainSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
    return;
  }

  const tenantId = request.tenant!.id;
  const domain = parsed.data.domain.toLowerCase();

  // Check if domain is already registered for this tenant
  const { data: existingDomain, error: checkError } = await supabaseAdmin
    .from('domains')
    .select('id, domain, verified, dkim_tokens, created_at, verified_at')
    .eq('tenant_id', tenantId)
    .eq('domain', domain)
    .maybeSingle();

  if (checkError) {
    response.status(500).json({ error: 'Failed to check existing domain' });
    return;
  }

  if (existingDomain) {
    if (existingDomain.verified) {
      response.status(409).json({ error: 'Domain already registered and verified for this tenant' });
      return;
    }

    // Gracefully resume domain verification for unverified domain
    const dnsRecords = buildFullDnsRecords(domain, existingDomain.dkim_tokens ?? []);
    response.status(200).json({
      domain: existingDomain,
      dnsRecords,
      message: 'Domain registration resumed. Please verify the DNS records.',
    });
    return;
  }

  // Enforce domain limit check
  const plan = request.tenant!.plan as PlanName;
  const planLimits = PLAN_LIMITS[plan];
  const maxDomains = resolvePlanLimit(request.tenant!.max_domains, planLimits.max_domains);

  if (maxDomains !== null) {
    const { count, error: countError } = await supabaseAdmin
      .from('domains')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId);

    if (countError) {
      response.status(500).json({ error: 'Failed to retrieve domain count' });
      return;
    }

    if ((count ?? 0) >= maxDomains) {
      response.status(403).json({ error: 'Domain limit reached. Upgrade your plan.' });
      return;
    }
  }

  // ── Register with SES (SESv2) ─────────────────────────────────────────────
  let dkimTokens: string[];
  try {
    dkimTokens = await sesRegisterDomain(domain);
  } catch (err) {
    console.error('[domains] SES register error:', err);
    response.status(502).json({
      error: 'Failed to register domain with SES',
      detail: (err as Error).message,
    });
    return;
  }

  // ── Persist ───────────────────────────────────────────────────────────────
  const { data, error } = await supabaseAdmin
    .from('domains')
    .insert({ tenant_id: tenantId, domain, verified: false, dkim_tokens: dkimTokens })
    .select('id, domain, verified, dkim_tokens, created_at, verified_at')
    .single();

  if (error) {
    if (error.code === '23505') {
      response.status(409).json({ error: 'Domain already registered for this tenant' });
      return;
    }
    response.status(500).json({ error: 'Failed to save domain' });
    return;
  }

  // ── Build all 5 DNS records (SPF + DMARC + 3 DKIM CNAMEs) ────────────────
  const dnsRecords = buildFullDnsRecords(domain, dkimTokens);

  response.status(201).json({ domain: data, dnsRecords });
});

// ── GET /v1/domains/:id/records ───────────────────────────────────────────────
// Re-fetch DNS records to show again (after user closed the modal).

domainsRouter.get('/:id/records', async (request, response) => {
  const tenantId = request.tenant!.id;

  const { data: domainRow, error } = await supabaseAdmin
    .from('domains')
    .select('id, domain, dkim_tokens, verified')
    .eq('id', request.params.id)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error) { response.status(500).json({ error: 'Failed to fetch domain' }); return; }
  if (!domainRow) { response.status(404).json({ error: 'Domain not found' }); return; }

  const dnsRecords = buildFullDnsRecords(domainRow.domain, domainRow.dkim_tokens ?? []);
  response.json({ domain: domainRow, dnsRecords });
});

// ── GET /v1/domains/:id/verify ────────────────────────────────────────────────
// Manual check — polls SES and flips verified=true if DKIM confirmed.

domainsRouter.get('/:id/verify', async (request, response) => {
  const tenantId = request.tenant!.id;

  const { data: domainRow, error: fetchError } = await supabaseAdmin
    .from('domains')
    .select('id, domain, dkim_tokens, verified')
    .eq('id', request.params.id)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (fetchError) { response.status(500).json({ error: 'Failed to fetch domain' }); return; }
  if (!domainRow) { response.status(404).json({ error: 'Domain not found' }); return; }

  if (domainRow.verified) {
    response.json({ verified: true, message: 'Domain is already verified' });
    return;
  }

  let sesStatus: { dkimVerified: boolean; sendingEnabled: boolean; dkimStatus: string };
  try {
    sesStatus = await sesGetDomainStatus(domainRow.domain);
  } catch (err) {
    console.error('[domains/verify] SES status error:', err);
    response.status(502).json({ error: 'Failed to check SES status', detail: (err as Error).message });
    return;
  }

  if (!sesStatus.dkimVerified) {
    response.status(422).json({
      verified: false,
      message: 'DKIM not yet confirmed by SES. Publish the 3 CNAME records and wait for DNS propagation (5 min – 48 hrs).',
      dkimStatus: sesStatus.dkimStatus,
    });
    return;
  }

  // Flip verified
  const { data: updated, error: updateError } = await supabaseAdmin
    .from('domains')
    .update({ verified: true, verified_at: new Date().toISOString() })
    .eq('id', domainRow.id)
    .eq('tenant_id', tenantId)
    .select('id, domain, verified, dkim_tokens, created_at, verified_at')
    .single();

  if (updateError || !updated) {
    response.status(500).json({ error: 'Failed to update verification status' });
    return;
  }

  response.json({ verified: true, domain: updated });
});

// ── DELETE /v1/domains/:id ────────────────────────────────────────────────────

domainsRouter.delete('/:id', async (request, response) => {
  const tenantId = request.tenant!.id;

  const { error } = await supabaseAdmin
    .from('domains')
    .delete()
    .eq('id', request.params.id)
    .eq('tenant_id', tenantId);

  if (error) { response.status(500).json({ error: 'Failed to delete domain' }); return; }
  response.status(204).send();
});
