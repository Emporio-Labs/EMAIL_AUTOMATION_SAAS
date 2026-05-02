import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase';
import { normalizeEmail } from '../utils/normalize-email';

export const unsubscribeRouter = Router();

const unsubscribeSchema = z.object({
  email: z.string().trim().email(),
});

unsubscribeRouter.post('/', async (request, response) => {
  const parsed = unsubscribeSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({ error: 'Invalid payload', issues: parsed.error.flatten() });
    return;
  }

  const email = normalizeEmail(parsed.data.email);

  const { error } = await supabaseAdmin
    .from('contacts')
    .update({
      is_subscribed: false,
      updated_at: new Date().toISOString(),
    })
    .eq('email', email);

  if (error) {
    response.status(500).json({ error: 'Failed to unsubscribe contact' });
    return;
  }

  response.json({ success: true, email, unsubscribed: true });
});
