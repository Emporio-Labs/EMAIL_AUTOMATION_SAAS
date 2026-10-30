/**
 * otp-monitor.ts
 *
 * Background job: every 15 minutes, checks each tenant's OTP bounce and
 * complaint rates over the last 24 hours. A high rate usually means someone is
 * abusing a signup form to mail random addresses, which can get the whole SES
 * account paused, so the tenant's OTP sending is paused until an admin resumes
 * it. Also deletes codes older than a week.
 */

import { randomUUID } from 'crypto';
import { env } from './config/env';
import { OTP_BOUNCE_POLICY, evaluateOtpBounces } from './lib/otp';
import { buildEmailJobMessage, publishEmailJobMessage } from './lib/sqs';
import { supabaseAdmin } from './lib/supabase';

const CHECK_INTERVAL_MS = 15 * 60 * 1000;

async function notify(tenantId: string, subject: string, text: string): Promise<void> {
  console.warn(`[otp-monitor] ${subject}`);
  if (!env.OTP_ALERT_EMAIL) return;
  try {
    // Platform mail with no email_jobs row: the worker sends it anyway.
    await publishEmailJobMessage(
      buildEmailJobMessage({
        jobId: randomUUID(),
        tenantId,
        from: env.PLATFORM_FROM_EMAIL,
        fromName: env.PLATFORM_FROM_NAME,
        to: env.OTP_ALERT_EMAIL,
        subject,
        html: '',
        text,
        configurationSetName: env.SES_CONFIGURATION_SET,
      }),
      env.OTP_SQS_QUEUE_URL ?? env.SQS_QUEUE_URL,
    );
  } catch (error) {
    console.error('[otp-monitor] Failed to send alert email:', error instanceof Error ? error.message : error);
  }
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

export async function checkOtpBounceRates(): Promise<void> {
  const since = new Date(Date.now() - OTP_BOUNCE_POLICY.windowHours * 3600 * 1000).toISOString();
  const { data: stats, error } = await supabaseAdmin.rpc('otp_bounce_stats', { p_since: since });
  if (error) {
    console.error('[otp-monitor] Failed to load bounce stats:', error.message);
    return;
  }

  type StatsRow = { tenant_id: string; sent: number; bounced: number; complained: number };
  for (let row of (stats ?? []) as StatsRow[]) {
    if (evaluateOtpBounces(row).verdict === 'ok') continue;

    const [{ data: settings }, { data: recent }, { data: tenant }] = await Promise.all([
      supabaseAdmin.from('otp_settings').select('paused_at, resumed_at').eq('tenant_id', row.tenant_id).maybeSingle(),
      supabaseAdmin.from('otp_alerts').select('level').eq('tenant_id', row.tenant_id).gt('created_at', since).limit(10),
      supabaseAdmin.from('tenants').select('name').eq('id', row.tenant_id).maybeSingle(),
    ]);
    if (settings?.paused_at) continue;

    // After an admin resumes a tenant, judge only the mail sent since then.
    if (settings?.resumed_at && new Date(settings.resumed_at) > new Date(since)) {
      const { data: fresh } = await supabaseAdmin.rpc('otp_bounce_stats', { p_since: settings.resumed_at, p_tenant_id: row.tenant_id });
      const freshRow = (fresh as StatsRow[] | null)?.[0];
      if (!freshRow) continue;
      row = freshRow;
    }
    const { verdict, bounceRate, complaintRate } = evaluateOtpBounces(row);
    if (verdict === 'ok') continue;
    if (verdict === 'warning' && recent?.length) continue; // one warning per window

    const summary = `${row.sent} OTP emails in ${OTP_BOUNCE_POLICY.windowHours}h, ${pct(bounceRate)} bounced, ${pct(complaintRate)} complaints`;
    const tenantName = tenant?.name ?? row.tenant_id;

    if (verdict === 'pause') {
      await supabaseAdmin
        .from('otp_settings')
        .update({ paused_at: new Date().toISOString(), paused_reason: summary })
        .eq('tenant_id', row.tenant_id);
    }
    await supabaseAdmin.from('otp_alerts').insert({
      tenant_id: row.tenant_id,
      level: verdict === 'pause' ? 'paused' : 'warning',
      sent_count: row.sent,
      bounce_rate: bounceRate,
      complaint_rate: complaintRate,
    });
    await notify(
      row.tenant_id,
      verdict === 'pause' ? `OTP paused for ${tenantName}` : `OTP bounce warning for ${tenantName}`,
      `${summary}.\n\nTenant: ${tenantName} (${row.tenant_id})\n`
        + (verdict === 'pause'
          ? 'OTP sending is paused. Resume it with POST /v1/admin/tenants/<id>/otp/resume after checking the account.'
          : `OTP sending pauses automatically at ${pct(OTP_BOUNCE_POLICY.pauseBounceRate)} bounces.`),
    );
  }

  const { error: purgeError } = await supabaseAdmin.rpc('purge_old_otp_codes');
  if (purgeError) console.error('[otp-monitor] Failed to purge old codes:', purgeError.message);
}

export function startOtpMonitor(): void {
  checkOtpBounceRates();
  setInterval(checkOtpBounceRates, CHECK_INTERVAL_MS);
  console.log('[otp-monitor] Started — checking OTP bounce rates every 15 minutes.');
}
