export const PLAN_LIMITS = {
  free: {
    monthly_email_limit: 1000,
    rate_limit: 20,
    max_domains: 1,
    max_sending_addresses: 3,
    max_recipients_per_send: 1,
    can_send_marketing: false,
    can_use_webhooks: false,
    can_track_opens: false,
    can_track_clicks: false,
    is_purchasable: true,
  },
  beta: {
    monthly_email_limit: 5000,
    rate_limit: 60,
    max_domains: 2,
    max_sending_addresses: 3,
    max_recipients_per_send: 50,
    can_send_marketing: false,
    can_use_webhooks: false,
    can_track_opens: true,
    can_track_clicks: true,
    is_purchasable: false,
  },
  starter: {
    monthly_email_limit: 25000,
    rate_limit: 120,
    max_domains: 2,
    max_sending_addresses: 3,
    max_recipients_per_send: 50,
    can_send_marketing: true,
    can_use_webhooks: false,
    can_track_opens: false,
    can_track_clicks: false,
    is_purchasable: true,
  },
  growth: {
    monthly_email_limit: 100000,
    rate_limit: 500,
    max_domains: 5,
    max_sending_addresses: 10,
    max_recipients_per_send: 500,
    can_send_marketing: true,
    can_use_webhooks: true,
    can_track_opens: true,
    can_track_clicks: true,
    is_purchasable: true,
  },
  scale: {
    monthly_email_limit: 500000,
    rate_limit: 2000,
    max_domains: null,
    max_sending_addresses: null,
    max_recipients_per_send: 1000,
    can_send_marketing: true,
    can_use_webhooks: true,
    can_track_opens: true,
    can_track_clicks: true,
    is_purchasable: true,
  },
} as const;

export type PlanName = keyof typeof PLAN_LIMITS;

export function resolvePlanLimit(
  tenantOverride: number | null | undefined,
  planDefault: number | null
): number | null {
  return tenantOverride ?? planDefault;
}

// Overloaded helper for boolean limits
export function resolvePlanBooleanLimit(
  tenantOverride: boolean | null | undefined,
  planDefault: boolean
): boolean {
  return tenantOverride ?? planDefault;
}
