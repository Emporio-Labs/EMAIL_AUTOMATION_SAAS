import crypto from 'crypto';
import { env } from '../config/env';
import { escapeHtml } from './tracker';

// Pure helpers for the email OTP API: code generation and hashing, the email
// template, sender subdomains, CAPTCHA checks and bounce thresholds.

export const OTP_LIMITS = {
  perEmailPerMinute: 1,
  perEmailPerHour: 5,
  perIpPerHour: 20,
  // Used when the tenant has no rate_limit of its own.
  perTenantPerMinuteDefault: 60,
};

export const OTP_BOUNCE_POLICY = {
  windowHours: 24,
  minSent: 50,
  warnBounceRate: 0.02,
  pauseBounceRate: 0.05,
  // OTP mail is wanted mail, so even a few complaints point to abuse.
  pauseComplaintRate: 0.005,
  minComplaints: 2,
};

const hmacKey = env.OTP_HMAC_KEY ?? crypto.createHash('sha256').update(`otp:${env.INTERNAL_KEY}`).digest('hex');

export function generateOtpCode(length: number): string {
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += crypto.randomInt(0, 10).toString();
  }
  return code;
}

/** Bound to the code's id so equal codes never share a hash. */
export function hashOtpCode(codeId: string, code: string): string {
  return crypto.createHmac('sha256', hmacKey).update(`${codeId}:${code}`).digest('hex');
}

/** Accepts "123 456" or "123-456" as typed by a person. */
export function normalizeOtpInput(code: string): string {
  return code.replace(/[\s-]/g, '');
}

// ── Template ──────────────────────────────────────────────────────────────────

export type OtpEmail = { subject: string; text: string; html: string };

export function renderOtpEmail(input: { code: string; appName: string; ttlMinutes: number }): OtpEmail {
  const { code, appName, ttlMinutes } = input;
  const subject = `${code} is your ${appName} verification code`;
  const text = [
    `Your ${appName} verification code is ${code}`,
    '',
    `It expires in ${ttlMinutes} minutes. Do not share it with anyone.`,
    `If you did not ask for this code, you can ignore this email.`,
  ].join('\n');

  const app = escapeHtml(appName);
  const html = `<!doctype html><html><body style="margin:0;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#202124;">`
    + `<p style="margin:0 0 16px;font-size:15px;">Your ${app} verification code is</p>`
    + `<p style="margin:0 0 16px;font-size:30px;font-weight:bold;letter-spacing:6px;font-family:'Courier New',monospace;">${escapeHtml(code)}</p>`
    + `<p style="margin:0 0 8px;font-size:13px;color:#5f6368;">It expires in ${ttlMinutes} minutes. Do not share it with anyone.</p>`
    + `<p style="margin:0;font-size:13px;color:#5f6368;">If you did not ask for this code, you can ignore this email.</p>`
    + `</body></html>`;

  return { subject, text, html };
}

// ── Default sender subdomain ─────────────────────────────────────────────────

const RESERVED_LABELS = new Set([
  'www', 'mail', 'smtp', 'imap', 'pop', 'mx', 'api', 'app', 'admin', 'root', 'support', 'help',
  'billing', 'status', 'otp', 'verify', 'noreply', 'no-reply', 'bounce', 'bounces', 'dmarc',
  'swayam', 'swayammail', 'swayamail', 'security', 'abuse', 'postmaster', 'test',
]);

/** Turns a tenant slug or name into a valid DNS label, or null if nothing usable is left. */
export function toSubdomainLabel(raw: string): string | null {
  const label = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-') // underscores and dots are not allowed in hostnames
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
    .replace(/-$/, '');
  return label.length >= 3 ? label : null;
}

export function validateSubdomainLabel(label: string): string | null {
  if (!/^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/.test(label)) {
    return 'Use 3 to 40 lowercase letters, digits or hyphens, starting and ending with a letter or digit.';
  }
  if (RESERVED_LABELS.has(label)) {
    return `"${label}" is reserved.`;
  }
  return null;
}

export function defaultOtpSender(label: string): string | null {
  return env.OTP_SENDING_DOMAIN ? `noreply@${label}.${env.OTP_SENDING_DOMAIN}` : null;
}

// ── CAPTCHA ───────────────────────────────────────────────────────────────────

const CAPTCHA_VERIFY_URLS = {
  turnstile: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  hcaptcha: 'https://api.hcaptcha.com/siteverify',
} as const;

export type CaptchaProvider = keyof typeof CAPTCHA_VERIFY_URLS;

export async function verifyCaptcha(
  provider: CaptchaProvider,
  secret: string,
  token: string,
  remoteIp?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const form = new URLSearchParams({ secret, response: token });
  if (remoteIp) form.set('remoteip', remoteIp);
  try {
    const res = await fetchImpl(CAPTCHA_VERIFY_URLS[provider], {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { success?: boolean };
    return body.success === true;
  } catch (error) {
    console.error('[otp] CAPTCHA verification failed:', error instanceof Error ? error.message : error);
    return false;
  }
}

// ── Bounce monitor ────────────────────────────────────────────────────────────

export type BounceVerdict = 'ok' | 'warning' | 'pause';

export function evaluateOtpBounces(stats: { sent: number; bounced: number; complained: number }): {
  verdict: BounceVerdict;
  bounceRate: number;
  complaintRate: number;
} {
  const bounceRate = stats.sent ? stats.bounced / stats.sent : 0;
  const complaintRate = stats.sent ? stats.complained / stats.sent : 0;
  if (stats.sent < OTP_BOUNCE_POLICY.minSent) {
    return { verdict: 'ok', bounceRate, complaintRate };
  }
  if (bounceRate >= OTP_BOUNCE_POLICY.pauseBounceRate || (stats.complained >= OTP_BOUNCE_POLICY.minComplaints && complaintRate >= OTP_BOUNCE_POLICY.pauseComplaintRate)) {
    return { verdict: 'pause', bounceRate, complaintRate };
  }
  if (bounceRate >= OTP_BOUNCE_POLICY.warnBounceRate) {
    return { verdict: 'warning', bounceRate, complaintRate };
  }
  return { verdict: 'ok', bounceRate, complaintRate };
}
