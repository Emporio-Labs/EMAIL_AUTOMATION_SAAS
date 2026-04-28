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
    response.status(401).json({ error: 'Missing bearer token' });
    return;
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !data.user) {
    response.status(401).json({ error: 'Invalid session' });
    return;
  }

  request.authUser = data.user;
  next();
}