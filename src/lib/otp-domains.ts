import { ChangeResourceRecordSetsCommand, Route53Client } from '@aws-sdk/client-route-53';
import { awsCredentials } from '../config/aws';
import { env } from '../config/env';
import { isSesAlreadyExists, sesDeleteDomain, sesGetDomainStatus, sesRegisterDomain } from './ses';
import { supabaseAdmin } from './supabase';

// Default OTP sender subdomains: <label>.<OTP_SENDING_DOMAIN>.
//
// Without OTP_ROUTE53_HOSTED_ZONE_ID the parent domain's SES identity (set up
// once, see DEPLOY.md) covers every subdomain, so a label works immediately.
// With it, each subdomain gets its own SES identity and DKIM keys, written to
// Route 53, so one customer can be disabled without touching the others.

export type SubdomainStatus = 'none' | 'pending' | 'verified' | 'failed';

function perTenantIdentities(): boolean {
  return Boolean(env.OTP_ROUTE53_HOSTED_ZONE_ID);
}

async function writeDkimRecords(hostname: string, tokens: string[], action: 'UPSERT' | 'DELETE'): Promise<void> {
  const client = new Route53Client({ region: 'us-east-1', credentials: awsCredentials });
  await client.send(
    new ChangeResourceRecordSetsCommand({
      HostedZoneId: env.OTP_ROUTE53_HOSTED_ZONE_ID,
      ChangeBatch: {
        Comment: `Swayam OTP DKIM for ${hostname}`,
        Changes: tokens.map((token) => ({
          Action: action,
          ResourceRecordSet: {
            Name: `${token}._domainkey.${hostname}`,
            Type: 'CNAME',
            TTL: 1800,
            ResourceRecords: [{ Value: `${token}.dkim.amazonses.com` }],
          },
        })),
      },
    }),
  );
}

/**
 * Sets up <label>.<OTP_SENDING_DOMAIN> for sending and returns its status.
 * The caller has already reserved the label in otp_settings.
 */
export async function provisionOtpSubdomain(label: string): Promise<{ status: SubdomainStatus; dkimTokens: string[] | null }> {
  if (!env.OTP_SENDING_DOMAIN) {
    throw new Error('OTP_SENDING_DOMAIN is not configured');
  }
  if (!perTenantIdentities()) {
    return { status: 'verified', dkimTokens: null };
  }

  const hostname = `${label}.${env.OTP_SENDING_DOMAIN}`;
  let tokens: string[];
  try {
    tokens = await sesRegisterDomain(hostname);
  } catch (error) {
    if (!isSesAlreadyExists(error)) throw error;
    // A retry after a partial failure: the identity exists, so reuse it.
    const status = await sesGetDomainStatus(hostname);
    return { status: status.dkimVerified ? 'verified' : 'pending', dkimTokens: null };
  }

  try {
    await writeDkimRecords(hostname, tokens, 'UPSERT');
  } catch (error) {
    await sesDeleteDomain(hostname).catch(() => undefined);
    throw error;
  }
  return { status: 'pending', dkimTokens: tokens };
}

export async function releaseOtpSubdomain(label: string, dkimTokens: string[] | null): Promise<void> {
  if (!env.OTP_SENDING_DOMAIN || !perTenantIdentities()) return;
  const hostname = `${label}.${env.OTP_SENDING_DOMAIN}`;
  await sesDeleteDomain(hostname);
  if (dkimTokens?.length) {
    await writeDkimRecords(hostname, dkimTokens, 'DELETE').catch((error) =>
      console.error(`[otp] Failed to remove DKIM records for ${hostname}:`, error instanceof Error ? error.message : error),
    );
  }
}

/** Flips pending subdomains to verified once SES sees their DKIM records. Run by the domain poller. */
export async function checkPendingOtpSubdomains(): Promise<void> {
  if (!env.OTP_SENDING_DOMAIN || !perTenantIdentities()) return;

  const { data: pending, error } = await supabaseAdmin
    .from('otp_settings')
    .select('tenant_id, subdomain_label')
    .eq('subdomain_status', 'pending');
  if (error) {
    console.error('[otp] Failed to load pending subdomains:', error.message);
    return;
  }

  for (const row of pending ?? []) {
    const hostname = `${row.subdomain_label}.${env.OTP_SENDING_DOMAIN}`;
    try {
      const status = await sesGetDomainStatus(hostname);
      if (status.dkimVerified) {
        await supabaseAdmin
          .from('otp_settings')
          .update({ subdomain_status: 'verified', updated_at: new Date().toISOString() })
          .eq('tenant_id', row.tenant_id);
        console.log(`[otp] Subdomain verified: ${hostname}`);
      } else if (status.dkimStatus === 'FAILED') {
        await supabaseAdmin
          .from('otp_settings')
          .update({ subdomain_status: 'failed', updated_at: new Date().toISOString() })
          .eq('tenant_id', row.tenant_id);
        console.error(`[otp] Subdomain DKIM failed: ${hostname}`);
      }
    } catch (err) {
      console.error(`[otp] SES check failed for ${hostname}:`, (err as Error).message);
    }
  }
}
