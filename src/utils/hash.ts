import { createHash } from 'crypto';

/**
 * Computes the SHA-256 hash of a string, returning its hex representation.
 * Used for deduplicating email HTML body content in the database.
 */
export function computeHtmlHash(html: string): string {
  return createHash('sha256').update(html, 'utf8').digest('hex');
}
