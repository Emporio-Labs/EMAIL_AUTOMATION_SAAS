import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { requireAuth } from '../middleware/require-auth';
import { requireTenant } from '../middleware/require-tenant';
import { supabaseAdmin } from '../lib/supabase';

export const apiKeysRouter = Router();

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(['sandbox', 'production']),
});

function generateApiKey(type: 'sandbox' | 'production'): string {
  const prefix = type === 'sandbox' ? 'sk_test_' : 'sk_prod_';
  const secret = crypto.randomBytes(32).toString('hex');
  return prefix + secret;
}

apiKeysRouter.use(requireAuth, requireTenant);

apiKeysRouter.get('/', async (request, response) => {
  const tenantId = request.tenant?.id;

  const { data, error } = await supabaseAdmin
    .from('api_keys')
    .select('id, name, key_preview, type, created_at, last_used_at, revoked_at')
    .eq('tenant_id', tenantId as string)
    .is('revoked_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    response.status(500).json({ error: 'Failed to load API keys' });
    return;
  }

  response.json({ apiKeys: data ?? [] });
});

apiKeysRouter.post('/', async (request, response) => {
  const parsed = createSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
    return;
  }

  const tenantId = request.tenant?.id;
  const userId = request.authUser?.id;

  if (!userId) {
    response.status(401).json({ error: 'Authentication required' });
    return;
  }

  const { count, error: countError } = await supabaseAdmin
    .from('api_keys')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId as string)
    .is('revoked_at', null);

  if (countError) {
    response.status(500).json({ error: 'Failed to check API key limit' });
    return;
  }

  if ((count ?? 0) >= 5) {
    response.status(403).json({ error: 'Max 5 API keys allowed' });
    return;
  }

  const rawKey = generateApiKey(parsed.data.type);
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const keyPreview = `...${rawKey.slice(-4)}`;

  const { data, error } = await supabaseAdmin
    .from('api_keys')
    .insert({
      tenant_id: tenantId as string,
      name: parsed.data.name,
      key_hash: keyHash,
      key_preview: keyPreview,
      type: parsed.data.type,
      created_by_user_id: userId,
    })
    .select('id, name, key_preview, type, created_at, last_used_at')
    .single();

  if (error || !data) {
    response.status(500).json({ error: 'Failed to create API key' });
    return;
  }

  response.status(201).json({ apiKey: data, key: rawKey });
});

apiKeysRouter.delete('/:id', async (request, response) => {
  const tenantId = request.tenant?.id;

  const { data, error } = await supabaseAdmin
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('tenant_id', tenantId as string)
    .eq('id', request.params.id)
    .is('revoked_at', null)
    .select('id')
    .maybeSingle();

  if (error) {
    response.status(500).json({ error: 'Failed to revoke API key' });
    return;
  }

  if (!data) {
    response.status(404).json({ error: 'API key not found' });
    return;
  }

  response.json({ revoked: true });
});
