/**
 * domain-poller.ts
 *
 * Background job: polls SES every 10 minutes for pending (unverified) domains
 * and flips verified=true in the DB when SES confirms DKIM.
 *
 * Called once from index.ts on startup.
 */

import { supabaseAdmin } from './lib/supabase';
import { sesGetDomainStatus } from './lib/ses';

const POLL_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

async function checkPendingDomains(): Promise<void> {
  const { data: pending, error } = await supabaseAdmin
    .from('domains')
    .select('id, domain, tenant_id')
    .eq('verified', false);

  if (error) {
    console.error('[domain-poller] Failed to fetch pending domains:', error.message);
    return;
  }

  if (!pending || pending.length === 0) return;

  console.log(`[domain-poller] Checking ${pending.length} pending domain(s)...`);

  for (const row of pending) {
    try {
      const status = await sesGetDomainStatus(row.domain);

      if (status.dkimVerified) {
        const { error: updateError } = await supabaseAdmin
          .from('domains')
          .update({ verified: true, verified_at: new Date().toISOString() })
          .eq('id', row.id);

        if (updateError) {
          console.error(`[domain-poller] Failed to update ${row.domain}:`, updateError.message);
        } else {
          console.log(`[domain-poller] ✅ Domain verified: ${row.domain} (tenant ${row.tenant_id})`);
        }
      }
    } catch (err) {
      // Don't crash the loop — SES might be temporarily unreachable
      console.error(`[domain-poller] SES check failed for ${row.domain}:`, (err as Error).message);
    }
  }
}

export function startDomainPoller(): void {
  // Run once immediately on startup
  checkPendingDomains();

  // Then every 10 minutes
  setInterval(checkPendingDomains, POLL_INTERVAL_MS);

  console.log('[domain-poller] Started — polling every 10 minutes.');
}
