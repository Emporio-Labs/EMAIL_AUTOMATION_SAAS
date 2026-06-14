import { supabaseAdmin } from '../lib/supabase';

export interface TenantRow {
  id: string;
  name: string;
  slug: string | null;
  plan: string;
  rate_limit: number;
  monthly_email_limit: number;
  monthly_email_count: number;
  last_billing_reset: string;
  is_suspended: boolean;
  max_domains: number | null;
  max_sending_addresses: number | null;
  max_recipients_per_send: number | null;
  can_send_marketing: boolean | null;
  can_use_webhooks: boolean | null;
  can_track_opens: boolean | null;
  can_track_clicks: boolean | null;
  force_sandbox: boolean | null;
  trial_ends_at: string | null;
  internal_notes: string | null;
}

export async function processTenantLimits(tenant: TenantRow): Promise<{
  isSuspended: boolean;
  rateLimit: number;
  plan: string;
  monthlyEmailLimit: number;
  monthlyEmailCount: number;
  max_domains: number | null;
  max_sending_addresses: number | null;
  max_recipients_per_send: number | null;
  can_send_marketing: boolean | null;
  can_use_webhooks: boolean | null;
  can_track_opens: boolean | null;
  can_track_clicks: boolean | null;
  force_sandbox: boolean | null;
  trial_ends_at: string | null;
  internal_notes: string | null;
}> {
  const lastReset = new Date(tenant.last_billing_reset);
  const now = new Date();
  const isNewBillingCycle =
    lastReset.getUTCFullYear() !== now.getUTCFullYear() ||
    lastReset.getUTCMonth() !== now.getUTCMonth();

  let monthlyEmailCount = tenant.monthly_email_count;

  if (isNewBillingCycle && !tenant.is_suspended) {
    // Reset count in database
    const { error: resetError } = await supabaseAdmin
      .from('tenants')
      .update({
        monthly_email_count: 0,
        last_billing_reset: now.toISOString(),
      })
      .eq('id', tenant.id);

    if (resetError) {
      console.error('[processTenantLimits] Failed to reset monthly count for tenant:', tenant.id, resetError);
    } else {
      monthlyEmailCount = 0;
    }
  }

  return {
    isSuspended: tenant.is_suspended,
    rateLimit: tenant.rate_limit,
    plan: tenant.plan,
    monthlyEmailLimit: tenant.monthly_email_limit,
    monthlyEmailCount,
    max_domains: tenant.max_domains,
    max_sending_addresses: tenant.max_sending_addresses,
    max_recipients_per_send: tenant.max_recipients_per_send,
    can_send_marketing: tenant.can_send_marketing,
    can_use_webhooks: tenant.can_use_webhooks,
    can_track_opens: tenant.can_track_opens,
    can_track_clicks: tenant.can_track_clicks,
    force_sandbox: tenant.force_sandbox,
    trial_ends_at: tenant.trial_ends_at,
    internal_notes: tenant.internal_notes,
  };
}
