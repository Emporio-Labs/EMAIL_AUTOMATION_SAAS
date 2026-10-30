// End-to-end check against a local stack: Supabase (supabase start), LocalStack
// SQS, scripts/local/ses-mock.py, the API (npm start) and the Go worker.
// Setup: queues email-jobs + email-jobs-dlq in LocalStack; API and worker env with
// AWS_ENDPOINT_URL_SQS=http://localhost:4566 and AWS_ENDPOINT_URL_SESV2=http://127.0.0.1:4580.
// Usage: SES_MOCK_LOG=/path/sent.jsonl DEAD_LETTER_QUEUE_URL=... node scripts/local/e2e.mjs
//        (other variables come from the API's .env)
import 'dotenv/config';
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { SQSClient, SendMessageCommand, GetQueueAttributesCommand } from '@aws-sdk/client-sqs';

const API = process.env.API_URL ?? 'http://localhost:3000';
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const sqs = new SQSClient({ region: process.env.AWS_REGION });
const SENT_LOG = process.env.SES_MOCK_LOG;
const DLQ_URL = process.env.DEAD_LETTER_QUEUE_URL;
const run = Date.now().toString(36);
const results = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
async function call(path, { token, apiKey, method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (apiKey) headers['x-api-key'] = apiKey;
  const res = await fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, headers: res.headers };
}
async function makeTenant(label, plan) {
  const email = `${label}-${run}@example.com`;
  const password = 'password-123456';
  await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const login = await call('/v1/auth/login', { method: 'POST', body: { email, password } });
  const token = login.json.access_token;
  await call('/v1/auth/onboard', { token, method: 'POST', body: { tenantName: `${label} ${run}` } });
  const me = await call('/v1/auth/me', { token });
  const tenantId = me.json.tenant.id;
  await admin.from('tenants').update({ plan, rate_limit: 60, monthly_email_limit: 100000 }).eq('id', tenantId);
  return { token, tenantId };
}
function sentTo(predicate) {
  if (!fs.existsSync(SENT_LOG)) return [];
  return fs.readFileSync(SENT_LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter(predicate);
}
async function waitForJobs(jobIds, statuses = ['delivered', 'failed'], timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { data } = await admin.from('email_jobs').select('job_id, status').in('job_id', jobIds.slice(0, 150));
    if (data && data.length === Math.min(jobIds.length, 150) && data.every((j) => statuses.includes(j.status))) return data;
    await sleep(1000);
  }
  const { data } = await admin.from('email_jobs').select('job_id, status').in('job_id', jobIds.slice(0, 150));
  return data;
}

const domain = `acme-${run}.test`;
const from = `hello@${domain}`;

// ── Setup ────────────────────────────────────────────────────────────────────
const A = await makeTenant('alpha', 'growth');
const B = await makeTenant('bravo', 'growth');

const addDomain = await call('/v1/domains', { token: A.token, method: 'POST', body: { domain } });
await call(`/v1/domains/${addDomain.json.domain.id}/verify`, { token: A.token });
await call('/v1/sending-addresses', { token: A.token, method: 'POST', body: { address: from } });
const key = (await call('/v1/api-keys', { token: A.token, method: 'POST', body: { name: 'e2e', type: 'production' } })).json.key;

const bList = await call('/v1/lists', { token: B.token, method: 'POST', body: { name: `b-list-${run}` } });
await call(`/v1/lists/${bList.json.list?.id ?? bList.json.id}/contacts`, { token: B.token, method: 'POST', body: { emails: [`secret-${run}@bravo.test`] } });
const bListId = bList.json.list?.id ?? bList.json.id;

// ── 1. Cross-tenant list ─────────────────────────────────────────────────────
const cross = await call('/v1/send', { apiKey: key, method: 'POST', body: { from, subject: 's', html: '<p>x</p>', listIds: [bListId], emailType: 'transactional' } });
check('1. Sending to another tenant\'s list is refused', cross.status === 404, `status ${cross.status}`);

// ── 2 + 5. Transactional: no footer, no List-Unsubscribe, SES tags set ───────
const tx = await call('/v1/send', { apiKey: key, method: 'POST', body: { from, subject: `bill ${run}`, html: '<html><body><p>Your bill</p></body></html>', toEmails: [`client-${run}@example.com`], emailType: 'transactional' } });
check('Transactional send accepted', tx.status === 202, `status ${tx.status} ${tx.text.slice(0, 120)}`);
const txJobs = await waitForJobs(tx.json?.jobIds ?? []);
check('Transactional job delivered by worker', txJobs?.[0]?.status === 'delivered', JSON.stringify(txJobs));
const txSent = sentTo((m) => m.Content.Simple.Subject.Data === `bill ${run}`)[0];
check('2. Transactional email has no unsubscribe footer', txSent && !/unsubscribe/i.test(txSent.Content.Simple.Body.Html.Data));
check('2. Transactional email has no List-Unsubscribe header', txSent && !(txSent.Content.Simple.Headers ?? []).some((h) => h.Name === 'List-Unsubscribe'));
const tags = Object.fromEntries((txSent?.EmailTags ?? []).map((t) => [t.Name, t.Value]));
check('5. SES message tagged with job_id and tenant_id', tags.job_id === tx.json?.jobIds?.[0] && tags.tenant_id === A.tenantId, JSON.stringify(tags));

// ── 3. Bulk marketing send of 300 from the dashboard ──────────────────────────
const bulkTo = Array.from({ length: 300 }, (_, i) => `bulk${i}-${run}@example.com`);
const t0 = Date.now();
const bulk = await call('/v1/send', { token: A.token, method: 'POST', body: { from, subject: `promo ${run}`, html: '<p>Sale! <a href="https://shop.test/?a=1&amp;b=2">shop</a></p>', toEmails: bulkTo, emailType: 'marketing' } });
const apiMs = Date.now() - t0;
check('3. 300-recipient send returns quickly', bulk.status === 202 && apiMs < 10000, `status ${bulk.status}, ${apiMs} ms`);
const bulkJobs = await waitForJobs(bulk.json?.jobIds ?? [], ['delivered', 'failed'], 90000);
check('3. Worker delivered the bulk send', bulkJobs?.every((j) => j.status === 'delivered'), `${bulkJobs?.filter((j) => j.status === 'delivered').length}/150 sampled delivered`);
const promo = sentTo((m) => m.Content.Simple.Subject.Data === `promo ${run}`);
check('Marketing email has footer and List-Unsubscribe', promo.length > 0 && /unsubscribe/i.test(promo[0].Content.Simple.Body.Html.Data) && promo[0].Content.Simple.Headers.some((h) => h.Name === 'List-Unsubscribe'));

// ── 7. Signed click tracking ─────────────────────────────────────────────────
const link = promo[0]?.Content.Simple.Body.Html.Data.match(/href="(http:\/\/localhost:3000\/t\/c\/[^"]+)"/)?.[1];
const good = link ? await fetch(link, { redirect: 'manual' }) : null;
check('7. Signed click link redirects to the real URL', good?.status === 302 && good.headers.get('location') === 'https://shop.test/?a=1&b=2', `${good?.status} ${good?.headers.get('location')}`);
const parts = link?.split('/') ?? [];
const evil = Buffer.from('https://evil.test').toString('base64url');
const tampered = await fetch([...parts.slice(0, -2), evil, parts.at(-1)].join('/'), { redirect: 'manual' });
check('7. Tampered click link is refused', tampered.status === 400, `status ${tampered.status}`);
const legacy = await fetch(`${API}/t/c/00000000-0000-4000-8000-000000000000/${evil}`, { redirect: 'manual' });
check('7. Unsigned link with an unknown job is refused', legacy.status === 404, `status ${legacy.status}`);

// ── Unsubscribe blocks marketing, not bills ──────────────────────────────────
const unsubUrl = promo[0]?.Content.Simple.Headers.find((h) => h.Name === 'List-Unsubscribe')?.Value.slice(1, -1);
const unsubRecipient = promo[0]?.Destination.ToAddresses[0];
await fetch(unsubUrl, { method: 'POST' });
const mk2 = await call('/v1/send', { apiKey: key, method: 'POST', body: { from, subject: 'm2', html: '<p>x</p>', toEmails: [unsubRecipient], emailType: 'marketing' } });
check('Unsubscribed contact is blocked from marketing', mk2.status === 422, `status ${mk2.status}`);
const tx2 = await call('/v1/send', { apiKey: key, method: 'POST', body: { from, subject: 't2', html: '<p>x</p>', toEmails: [unsubRecipient], emailType: 'transactional' } });
check('Unsubscribed contact still gets transactional mail', tx2.status === 202, `status ${tx2.status}`);

// ── 6. Rate limit and atomic quota ───────────────────────────────────────────
await admin.from('tenants').update({ rate_limit: 5 }).eq('id', A.tenantId);
const burst = [];
for (let i = 0; i < 8; i++) burst.push((await call('/v1/send', { apiKey: key, method: 'POST', body: { from, subject: 'r', html: '<p>x</p>', toEmails: [`rate${i}-${run}@example.com`], emailType: 'transactional' } })).status);
check('6. Per-minute rate limit returns 429', burst.includes(429), burst.join(','));
await admin.from('tenants').update({ rate_limit: 10000 }).eq('id', A.tenantId);

const { data: before } = await admin.from('tenants').select('monthly_email_count').eq('id', A.tenantId).single();
await admin.from('tenants').update({ monthly_email_limit: before.monthly_email_count + 5 }).eq('id', A.tenantId);
const parallel = await Promise.all(Array.from({ length: 10 }, (_, i) =>
  call('/v1/send', { apiKey: key, method: 'POST', body: { from, subject: 'q', html: '<p>x</p>', toEmails: [`q${i}-${run}@example.com`], emailType: 'transactional' } })));
const { data: after } = await admin.from('tenants').select('monthly_email_count, monthly_email_limit').eq('id', A.tenantId).single();
const accepted = parallel.filter((r) => r.status === 202).length;
check('6. Parallel sends never exceed the monthly limit', accepted === 5 && after.monthly_email_count <= after.monthly_email_limit, `accepted ${accepted}, count ${after.monthly_email_count}/${after.monthly_email_limit}`);
await admin.from('tenants').update({ monthly_email_limit: 100000 }).eq('id', A.tenantId);

// ── 8. Duplicate SQS delivery is skipped; retries are capped ─────────────────
const dupJobId = tx.json.jobIds[0];
const beforeDup = sentTo((m) => m.Content.Simple.Subject.Data === `bill ${run}`).length;
await sqs.send(new SendMessageCommand({ QueueUrl: process.env.SQS_QUEUE_URL, MessageBody: JSON.stringify({ job_id: dupJobId, tenant_id: A.tenantId, from, to: `client-${run}@example.com`, subject: `bill ${run}`, html: '<p>dup</p>' }) }));
await sleep(8000);
check('8. Redelivered job is not sent twice', sentTo((m) => m.Content.Simple.Subject.Data === `bill ${run}`).length === beforeDup);

const failSend = await call('/v1/send', { apiKey: key, method: 'POST', body: { from, subject: 'f', html: '<p>x</p>', toEmails: ['fail-always@acme.test'], emailType: 'transactional' } });
const failJobs = await waitForJobs(failSend.json?.jobIds ?? [], ['failed'], 60000);
check('8. Always-failing send ends as failed after retry cap', failJobs?.[0]?.status === 'failed', JSON.stringify(failJobs));
const dlq = await sqs.send(new GetQueueAttributesCommand({ QueueUrl: DLQ_URL, AttributeNames: ['ApproximateNumberOfMessages'] }));
check('8. Failed message moved to DLQ', Number(dlq.Attributes.ApproximateNumberOfMessages) >= 1, dlq.Attributes.ApproximateNumberOfMessages);

// ── 10. Domain squatting ─────────────────────────────────────────────────────
const squat = await call('/v1/domains', { token: B.token, method: 'POST', body: { domain } });
check('10. Another tenant cannot claim a registered domain', squat.status === 409, `status ${squat.status}`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
