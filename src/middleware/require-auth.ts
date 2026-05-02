import type { NextFunction, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';

function getBearerToken(request: Request): string | null {
  const header = request.headers.authorization;

  if (!header?.startsWith('Bearer ')) {
    return null;
  }

  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

export async function requireAuth(request: Request, response: Response, next: NextFunction): Promise<void> {
  const token = getBearerToken(request);

  if (!token) {
    console.log('[requireAuth] Missing bearer token on route:', request.path);
    response.status(401).json({ error: 'Missing bearer token' });
    return;
  }

  console.log('[requireAuth] Validating token for route:', request.path, 'Token preview:', token.slice(0, 20) + '...');
  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error) {
    console.error('[requireAuth] Supabase getUser error:', error.message);
  }

  if (error || !data.user) {
    console.log('[requireAuth] Invalid session - error:', error?.message, 'user:', data?.user);
    response.status(401).json({ error: 'Invalid session' });
    return;
  }

  console.log('[requireAuth] Auth successful for user:', data.user.id, 'route:', request.path);
  request.authUser = data.user;
  next();
}