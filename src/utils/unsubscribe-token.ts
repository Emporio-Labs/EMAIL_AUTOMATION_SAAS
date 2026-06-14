import crypto from 'crypto';
import { env } from '../config/env';

// Derives a 32-byte key from a secret string using a salt
function getEncryptionKey(secret: string): Buffer {
  return crypto.scryptSync(secret, 'unsubscribe-salt', 32);
}

export function generateUnsubscribeToken(email: string, tenantId: string): string {
  const payload = JSON.stringify({ email, tenantId });
  const iv = crypto.randomBytes(16);
  const key = getEncryptionKey(env.INTERNAL_KEY);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  
  let encrypted = cipher.update(payload, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  // Format: iv:encrypted payload
  return `${iv.toString('hex')}:${encrypted}`;
}

export function decryptUnsubscribeToken(token: string): { email: string; tenantId: string } | null {
  try {
    const parts = token.split(':');
    if (parts.length !== 2) return null;
    
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    const key = getEncryptionKey(env.INTERNAL_KEY);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return JSON.parse(decrypted);
  } catch (error) {
    console.error('[decryptUnsubscribeToken] failed:', error);
    return null;
  }
}
