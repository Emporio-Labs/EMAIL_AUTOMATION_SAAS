import type { NextFunction, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';

export async function requireAdmin(request: Request, response: Response, next: NextFunction): Promise<void> {
  const userId = request.authUser?.id;

  if (!userId) {
    response.status(401).json({ error: 'Authentication required' });
    return;
  }

  const { data: adminRow, error: adminError } = await supabaseAdmin
    .from('system_admins')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (adminError) {
    console.error('[requireAdmin] Database lookup error:', adminError);
    response.status(500).json({ error: 'Failed to verify admin status' });
    return;
  }

  if (!adminRow) {
    response.status(403).json({ error: 'Access denied: System Administrator privileges required' });
    return;
  }

  next();
}
