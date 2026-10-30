/**
 * domain-poller.ts
 *
 * Background job: polls SES every 10 minutes for pending (unverified) domains
 * and flips verified=true in the DB when SES confirms DKIM.
 *
 * Called once from index.ts on startup.
 */

import { supabaseAdmin } from './lib/supabase';
import { sesDeleteDomain, sesGetDomainStatus } from './lib/ses';

const POLL_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
// A domain nobody verifies within this window is released, so a tenant cannot
// squat a domain they don't control and block its real owner.
const UNVERIFIED_TTL_MS = 72 * 60 * 60 * 1000;

async function checkPendingDomains(): Promise<void> {
  const { data: pending, error } = await supabaseAdmin
    .from('domains')
    .select('id, domain, tenant_id, created_at')
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
      } else if (Date.now() - new Date(row.created_at).getTime() > UNVERIFIED_TTL_MS) {
        await sesDeleteDomain(row.domain);
        await supabaseAdmin.from('domains').delete().eq('id', row.id).eq('verified', false);
        console.log(`[domain-poller] Released unverified domain after 72h: ${row.domain} (tenant ${row.tenant_id})`);
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
