import { PLAN_LIMITS } from '../config/plans';
import { escapeHtml } from './tracker';

export type InviteEmailInput = {
  email: string;
  signupUrl: string;
  /** Plan new tenants start on (tenants.plan defaults to 'starter'). */
  plan?: keyof typeof PLAN_LIMITS;
  supportEmail?: string;
  /** WhatsApp number in international format, e.g. 919876543210. */
  supportWhatsapp?: string;
};

export const INVITE_SUBJECT = "You're invited to the SwayamMail beta";

const fmt = (n: number) => n.toLocaleString('en-IN');

export function buildInviteEmail(input: InviteEmailInput): { subject: string; html: string; text: string } {
  const plan = input.plan ?? 'starter';
  const limits = PLAN_LIMITS[plan];
  const planName = plan.charAt(0).toUpperCase() + plan.slice(1);
  const email = escapeHtml(input.email);
  const url = escapeHtml(input.signupUrl);
  const wa = input.supportWhatsapp?.replace(/\D/g, '') || undefined;
  const domains = `up to ${limits.max_domains} sending domain${limits.max_domains === 1 ? '' : 's'}`;
  const planLine = `${fmt(limits.monthly_email_limit)} emails a month, ${domains}, ${limits.rate_limit} emails a minute`;

  const features: [string, string][] = [
    ['Email OTP API', 'Send and verify login codes with two API calls. CAPTCHA and bounce monitoring are built in.'],
    ['Transactional email', 'Receipts, alerts and notifications from your own domain, with DKIM set up for you.'],
    ['Delivery tracking', 'See every send, delivery, bounce and complaint on your dashboard.'],
  ];

  const code = (s: string) =>
    `<code style="font-family:Consolas,Menlo,monospace;background:#f4f4f0;padding:1px 5px;border-radius:4px">${s}</code>`;
  const steps = [
    'Create your account with this email address.',
    `Add your sending domain (for example ${code('mail.yourcompany.com')}) and publish the DNS records we show you.`,
    'Create an API key and send your first email.',
  ];

  const link = (href: string, label: string) =>
    `<a href="${href}" style="color:#1a7f5a;text-decoration:none;font-weight:600">${label}</a>`;
  const supportLinks: string[] = [];
  if (wa) supportLinks.push(link(`https://wa.me/${wa}`, 'WhatsApp us'));
  if (input.supportEmail) {
    const s = escapeHtml(input.supportEmail);
    supportLinks.push(link(`mailto:${s}`, s));
  }
  const supportHtml = supportLinks.length
    ? `Stuck on DNS or anything else? ${supportLinks.join(' or ')} and we'll set it up with you.`
    : `Stuck on DNS? Reply to this email and we'll set it up with you.`;

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f7f6f2">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f6f2;padding:32px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e7e5df;border-radius:16px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a">
<tr><td style="padding:32px 32px 8px">
  <div style="font-size:12px;letter-spacing:2px;color:#71717a;font-weight:600">SWAYAMMAIL</div>
  <h1 style="font-size:24px;line-height:1.3;margin:12px 0;font-weight:700">You're invited to the beta</h1>
  <p style="font-size:15px;line-height:1.6;color:#3f3f46;margin:0">SwayamMail sends your OTPs, transactional email and campaigns from one account, built for Indian businesses. Your beta access is ready.</p>
</td></tr>
<tr><td style="padding:24px 32px 8px">
  <a href="${url}" style="display:inline-block;background:#1a1a1a;color:#ffffff;text-decoration:none;padding:13px 26px;border-radius:9999px;font-size:15px;font-weight:600">Accept invite &amp; create account</a>
</td></tr>
<tr><td style="padding:24px 32px 0">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef7f2;border-radius:12px">
  <tr><td style="padding:16px 18px;font-size:14px;line-height:1.6;color:#14532d">
    <strong>Your beta plan: ${planName}, free during the beta</strong><br>${planLine}
  </td></tr></table>
</td></tr>
<tr><td style="padding:28px 32px 0">
  <h2 style="font-size:15px;margin:0 0 12px;font-weight:700">What you get</h2>
  ${features
    .map(([t, d]) => `<p style="font-size:14px;line-height:1.55;color:#3f3f46;margin:0 0 10px"><strong style="color:#1a1a1a">${t}.</strong> ${d}</p>`)
    .join('\n  ')}
</td></tr>
<tr><td style="padding:20px 32px 0">
  <h2 style="font-size:15px;margin:0 0 12px;font-weight:700">Get sending in three steps</h2>
  ${steps
    .map(
      (s, i) => `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 10px"><tr>
    <td valign="top" style="width:28px"><div style="width:20px;height:20px;border-radius:50%;background:#1a1a1a;color:#ffffff;font-size:11px;font-weight:700;text-align:center;line-height:20px">${i + 1}</div></td>
    <td style="font-size:14px;line-height:1.55;color:#3f3f46">${s}</td></tr></table>`,
    )
    .join('\n  ')}
</td></tr>
<tr><td style="padding:16px 32px 28px">
  <p style="font-size:14px;line-height:1.6;color:#3f3f46;margin:0">${supportHtml}</p>
</td></tr>
<tr><td style="padding:18px 32px 26px;border-top:1px solid #efeee9">
  <p style="font-size:12px;line-height:1.6;color:#8a8a93;margin:0">This invite was sent to ${email} and works only for that address. If the button doesn't work, open this link: <a href="${url}" style="color:#8a8a93">${url}</a><br>Didn't expect this? You can ignore it.</p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;

  const supportText = [wa && `WhatsApp: https://wa.me/${wa}`, input.supportEmail && `Email: ${input.supportEmail}`]
    .filter(Boolean)
    .join(' / ');

  const text = [
    "You're invited to the SwayamMail beta",
    '',
    'SwayamMail sends your OTPs, transactional email and campaigns from one account, built for Indian businesses.',
    '',
    `Accept the invite and create your account: ${input.signupUrl}`,
    '',
    `Your beta plan: ${planName}, free during the beta. ${planLine}.`,
    '',
    'What you get:',
    ...features.map(([t, d]) => `- ${t}: ${d}`),
    '',
    'Get sending in three steps:',
    '1. Create your account with this email address.',
    '2. Add your sending domain (for example mail.yourcompany.com) and publish the DNS records we show you.',
    '3. Create an API key and send your first email.',
    '',
    supportText
      ? `Stuck on DNS or anything else? ${supportText}`
      : "Stuck on DNS? Reply to this email and we'll set it up with you.",
    '',
    `This invite was sent to ${input.email}. Didn't expect it? You can ignore it.`,
  ].join('\n');

  return { subject: INVITE_SUBJECT, html, text };
}
