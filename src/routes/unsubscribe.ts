import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase';
import { normalizeEmail } from '../utils/normalize-email';
import { decryptUnsubscribeToken } from '../utils/unsubscribe-token';
import { requireAuth } from '../middleware/require-auth';
import { requireTenant } from '../middleware/require-tenant';

export const unsubscribeRouter = Router();

// 1. GET /v1/unsubscribe?t=TOKEN (User clicks unsubscribe link in browser)
unsubscribeRouter.get('/', async (request, response) => {
  const token = request.query.t;
  if (typeof token !== 'string') {
    response.status(400).send('<h1>Error</h1><p>Invalid or missing unsubscribe token.</p>');
    return;
  }

  const decrypted = decryptUnsubscribeToken(token);
  if (!decrypted) {
    response.status(400).send('<h1>Error</h1><p>Invalid or expired unsubscribe token.</p>');
    return;
  }

  const { email, tenantId } = decrypted;
  const normalized = normalizeEmail(email);

  // Update contact state
  const { error: updateError } = await supabaseAdmin
    .from('contacts')
    .update({ is_subscribed: false, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('email', normalized);

  // Add to suppressed list for this tenant
  const { error: suppressError } = await supabaseAdmin
    .from('suppressed')
    .insert({ tenant_id: tenantId, email: normalized, reason: 'unsubscribe' })
    .select()
    .maybeSingle();

  // If there's an insert error due to conflict, it's fine (already suppressed)
  if (updateError) {
    console.error('[unsubscribe] failed to update contact:', updateError);
    response.status(500).send('<h1>Error</h1><p>Failed to process unsubscribe request. Please try again later.</p>');
    return;
  }

  // Get tenant name for display
  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('name')
    .eq('id', tenantId)
    .maybeSingle();

  const tenantName = tenant?.name ?? 'the sender';

  response.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Unsubscribed</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #fafafa; color: #111110; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
          .card { background: white; border: 1px solid #e5e5e5; padding: 2.5rem; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.02); max-width: 400px; text-align: center; }
          h1 { font-size: 1.5rem; margin-bottom: 1rem; color: #111; font-weight: 600; }
          p { color: #666; font-size: 0.95rem; line-height: 1.5; margin-bottom: 0; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>Unsubscribed</h1>
          <p>You have been successfully unsubscribed from <strong>${tenantName}</strong> mailing list.</p>
        </div>
      </body>
    </html>
  `);
});

// 2. POST /v1/unsubscribe?t=TOKEN (RFC 8058 One-Click)
// OR POST /v1/unsubscribe (authenticated dashboard action)
unsubscribeRouter.post('/', async (request, response, next) => {
  const token = request.query.t;
  
  if (typeof token === 'string') {
    // Stateless One-Click Unsubscribe (public)
    const decrypted = decryptUnsubscribeToken(token);
    if (!decrypted) {
      response.status(400).json({ error: 'Invalid token' });
      return;
    }

    const { email, tenantId } = decrypted;
    const normalized = normalizeEmail(email);

    await Promise.all([
      supabaseAdmin
        .from('contacts')
        .update({ is_subscribed: false, updated_at: new Date().toISOString() })
        .eq('tenant_id', tenantId)
        .eq('email', normalized),
      supabaseAdmin
        .from('suppressed')
        .insert({ tenant_id: tenantId, email: normalized, reason: 'unsubscribe' })
    ]);

    response.json({ success: true, unsubscribed: true });
    return;
  }

  // Otherwise, it's an authenticated dashboard action
  requireAuth(request, response, () => {
    requireTenant(request, response, async () => {
      const schema = z.object({ email: z.string().trim().email() });
      const parsed = schema.safeParse(request.body);

      if (!parsed.success) {
        response.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
        return;
      }

      const email = normalizeEmail(parsed.data.email);
      const tenantId = request.tenant!.id;

      await Promise.all([
        supabaseAdmin
          .from('contacts')
          .update({ is_subscribed: false, updated_at: new Date().toISOString() })
          .eq('tenant_id', tenantId)
          .eq('email', email),
        supabaseAdmin
          .from('suppressed')
          .insert({ tenant_id: tenantId, email, reason: 'unsubscribe' })
      ]);

      response.json({ success: true, email, unsubscribed: true });
    });
  });
});
