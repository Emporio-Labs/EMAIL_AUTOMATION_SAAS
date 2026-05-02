/**
 * ses.ts — AWS SES v2 helpers for multi-tenant domain verification.
 *
 * Uses @aws-sdk/client-sesv2 (modern API).
 *
 * Flow:
 *  1. sesRegisterDomain()          → CreateEmailIdentityCommand → DKIM CNAME tokens from SES
 *  2. sesGetDomainStatus()         → GetEmailIdentityCommand    → live verification state
 *  3. buildFullDnsRecords()        → returns SPF + DMARC + 3 DKIM CNAMEs for display
 *  4. Background poller (index.ts) → calls sesGetDomainStatus() every 10 min
 */

import {
  SESv2Client,
  CreateEmailIdentityCommand,
  GetEmailIdentityCommand,
} from '@aws-sdk/client-sesv2';
import { awsCredentials } from '../config/aws';
import { env } from '../config/env';

// ── Lazy SES client factory ───────────────────────────────────────────────────
// Created per-call so a bad credential/config at startup doesn't crash the
// module and silently unregister the domains router.

function makeSesClient(): SESv2Client {
  return new SESv2Client({
    region: env.AWS_REGION,
    credentials: awsCredentials,
  });
}

// ── Register domain identity with SES ─────────────────────────────────────────

export async function sesRegisterDomain(domain: string): Promise<string[]> {
  const response = await makeSesClient().send(
    new CreateEmailIdentityCommand({
      EmailIdentity: domain,
      DkimSigningAttributes: {
        NextSigningKeyLength: 'RSA_2048_BIT',
      },
    }),
  );

  const tokens = response.DkimAttributes?.Tokens ?? [];
  if (tokens.length === 0) {
    throw new Error('SES did not return DKIM tokens for this domain.');
  }
  return tokens;
}

// ── Check live verification status ────────────────────────────────────────────

export type SesIdentityStatus = {
  dkimVerified: boolean;
  sendingEnabled: boolean;
  dkimStatus: string;
};

export async function sesGetDomainStatus(domain: string): Promise<SesIdentityStatus> {
  const response = await makeSesClient().send(
    new GetEmailIdentityCommand({ EmailIdentity: domain }),
  );

  const dkimStatus = response.DkimAttributes?.Status ?? 'NOT_STARTED';
  const dkimVerified = dkimStatus === 'SUCCESS';
  const sendingEnabled = (response as any).SendingAttributes?.SendingEnabled ?? false;

  return { dkimVerified, sendingEnabled, dkimStatus };
}

// ── Build all DNS records to display to the tenant ────────────────────────────
// Returns SPF (TXT) + DMARC (TXT) + 3 DKIM (CNAME) = 5 records total.

export type DnsRecord = {
  type: 'TXT' | 'CNAME';
  host: string;
  value: string;
  description: string;
};

export function buildFullDnsRecords(domain: string, dkimTokens: string[]): DnsRecord[] {
  const records: DnsRecord[] = [
    {
      type: 'TXT',
      host: '@',
      value: 'v=spf1 include:amazonses.com ~all',
      description: 'SPF — authorises SES to send on your behalf',
    },
    {
      type: 'TXT',
      host: '_dmarc',
      value: `v=DMARC1; p=quarantine; rua=mailto:dmarc@${domain}`,
      description: 'DMARC — tells Gmail what to do with unauthenticated mail',
    },
    ...dkimTokens.map((token, i) => ({
      type: 'CNAME' as const,
      host: `${token}._domainkey`,
      value: `${token}.dkim.amazonses.com`,
      description: `DKIM record ${i + 1} of 3`,
    })),
  ];
  return records;
}
