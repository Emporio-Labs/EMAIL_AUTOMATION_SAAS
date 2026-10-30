// End-to-end check of campaign scheduling against the local stack (see e2e.mjs).
// Usage: node scripts/local/e2e-campaigns.mjs   (env from the API's .env)
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const API = process.env.API_URL ?? 'http://localhost:3000';
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const run = Date.now().toString(36);
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
async function call(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}
async function waitFor(fn, timeoutMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await fn();
    if (value) return value;
    await sleep(1000);
  }
  return null;
}
const campaign = async (token, id) => (await call(`/v1/campaigns/${id}`, { token })).json.campaign;
const stats = async (token, id) => (await call(`/v1/campaigns/${id}/stats`, { token })).json.stats;

// ── Setup: tenant with a verified domain, 50-recipient chunks ────────────────
const email = `camp-${run}@example.com`;
await admin.auth.admin.createUser({ email, password: 'password-123456', email_confirm: true });
const token = (await call('/v1/auth/login', { method: 'POST', body: { email, password: 'password-123456' } })).json.access_token;
await call('/v1/auth/onboard', { token, method: 'POST', body: { tenantName: `Camp ${run}` } });
const tenantId = (await call('/v1/auth/me', { token })).json.tenant.id;
await admin.from('tenants').update({ plan: 'growth', max_recipients_per_send: 50, monthly_email_limit: 100000 }).eq('id', tenantId);
const domain = `camp-${run}.test`;
const from = `news@${domain}`;
const d = await call('/v1/domains', { token, method: 'POST', body: { domain } });
await call(`/v1/domains/${d.json.domain.id}/verify`, { token });
await call('/v1/sending-addresses', { token, method: 'POST', body: { address: from } });

const recipients = Array.from({ length: 1200 }, (_, i) => `r${i}-${run}@example.com`);
const created = await call('/v1/campaigns', {
  token,
  method: 'POST',
  body: {
    name: `Launch ${run}`,
    contacts: recipients.map((e) => ({ email: e, source: 'manual' })),
    subject: 'Hello {{first_name}}',
    html: '<p>Big news</p>',
    fromEmail: from,
    scheduledAt: new Date(Date.now() + 20_000).toISOString(),
  },
});
const id = created.json?.campaign?.id;
check('Campaign created as scheduled', created.status === 201 && created.json.campaign.status === 'scheduled', `${created.status} ${created.json?.campaign?.status}`);

// Two unsubscribed and one bounced recipient must be skipped.
await admin.from('contacts').update({ is_subscribed: false }).eq('tenant_id', tenantId).in('email', [recipients[5], recipients[700]]);
await admin.from('suppressed').insert({ tenant_id: null, email: recipients[900], reason: 'bounce' });

const edit = await call(`/v1/campaigns/${id}`, { token, method: 'PATCH', body: { html: '<p>Big news, edited</p>' } });
check('Content can be edited while scheduled', edit.status === 200 && edit.json.campaign.html.includes('edited'));

const early = await stats(token, id);
check('Nothing sent before the scheduled time', early.sent === 0 && early.pending === 1200, JSON.stringify(early));

// ── Starts on time, pause holds, resume finishes ─────────────────────────────
const runningCampaign = await waitFor(async () => {
  const c = await campaign(token, id);
  return c.status === 'running' || c.status === 'completed' ? c : null;
}, 60000);
check('Scheduler starts the campaign after scheduledAt', runningCampaign?.status === 'running', runningCampaign?.status);

const lockedEdit = await call(`/v1/campaigns/${id}`, { token, method: 'PATCH', body: { subject: 'changed' } });
check('Content is locked once sending starts', lockedEdit.status === 409, `status ${lockedEdit.status}`);

const pause = await call(`/v1/campaigns/${id}/pause`, { token, method: 'POST' });
check('Pause accepted', pause.status === 200 && pause.json.campaign.status === 'paused', `${pause.status} ${pause.json?.campaign?.status ?? pause.text}`);
await sleep(3000);
const atPause = await stats(token, id);
await sleep(20000);
const afterWait = await stats(token, id);
check('Paused campaign sends nothing more', atPause.sent === afterWait.sent && afterWait.pending > 0, `sent ${atPause.sent} → ${afterWait.sent}, pending ${afterWait.pending}`);

const resume = await call(`/v1/campaigns/${id}/resume`, { token, method: 'POST' });
check('Resume accepted', resume.status === 200 && resume.json.campaign.status === 'running', `${resume.status}`);

const done = await waitFor(async () => ((await campaign(token, id)).status === 'completed' ? true : null), 120000);
check('Campaign completes', Boolean(done));

const final = await stats(token, id);
check('Every eligible recipient got exactly one email', final.sent === 1197 && final.skipped === 3 && final.pending === 0, JSON.stringify(final));
const jobs = [];
for (let from = 0; ; from += 1000) {
  const { data } = await admin.from('email_jobs').select('to_email').eq('campaign_id', id).range(from, from + 999);
  jobs.push(...(data ?? []));
  if (!data || data.length < 1000) break;
}
check('No duplicate sends', jobs.length === 1197 && new Set(jobs.map((j) => j.to_email)).size === jobs.length, `${jobs.length} jobs`);
check('Unsubscribed and bounced recipients skipped', !jobs.some((j) => [recipients[5], recipients[700], recipients[900]].includes(j.to_email)));

const delivered = await waitFor(async () => {
  const s = await stats(token, id);
  return s.delivered >= 1197 ? s : null;
}, 90000);
check('Worker delivered them all (stats)', Boolean(delivered), JSON.stringify(delivered ?? (await stats(token, id))));

const badResume = await call(`/v1/campaigns/${id}/resume`, { token, method: 'POST' });
check('Cannot resume a completed campaign', badResume.status === 409, `status ${badResume.status}`);

// ── Send now, and pause on quota ─────────────────────────────────────────────
const { data: t } = await admin.from('tenants').select('monthly_email_count').eq('id', tenantId).single();
await admin.from('tenants').update({ monthly_email_limit: t.monthly_email_count + 120 }).eq('id', tenantId);
const second = await call('/v1/campaigns', {
  token,
  method: 'POST',
  body: { name: `Quota ${run}`, contacts: recipients.slice(0, 300).map((e) => ({ email: e, source: 'manual' })), subject: 's', html: '<p>x</p>', fromEmail: from },
});
const id2 = second.json.campaign.id;
check('Campaign without a time is a draft', second.json.campaign.status === 'draft');
const now = await call(`/v1/campaigns/${id2}/send-now`, { token, method: 'POST' });
check('Send now accepted', now.status === 200, `${now.status}`);
const paused = await waitFor(async () => {
  const c = await campaign(token, id2);
  return c.status === 'paused' ? c : null;
}, 60000);
const s2 = await stats(token, id2);
check('Campaign uses the remaining quota exactly, then pauses', Boolean(paused) && s2.sent === 120, `sent ${s2.sent}, error: ${paused?.last_error}`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
