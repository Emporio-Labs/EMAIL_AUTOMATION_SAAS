// End-to-end check of templates and merge tags against the local stack (see e2e.mjs).
// Usage: SES_MOCK_LOG=/path/sent.jsonl node scripts/local/e2e-templates.mjs   (env from the API's .env)
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const API = process.env.API_URL ?? 'http://localhost:3000';
const SES_LOG = process.env.SES_MOCK_LOG;
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
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
  const res = await fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}
// Messages the SES mock received for an address, newest last.
function sentTo(address) {
  return readFileSync(SES_LOG, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .filter((m) => (m.Destination?.ToAddresses ?? []).includes(address));
}
async function waitForMail(address, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = sentTo(address);
    if (found.length) return found[found.length - 1];
    await sleep(500);
  }
  return null;
}

async function tenant(label) {
  const email = `${label}-${run}@example.com`;
  await admin.auth.admin.createUser({ email, password: 'password-123456', email_confirm: true });
  const token = (await call('/v1/auth/login', { method: 'POST', body: { email, password: 'password-123456' } })).json.access_token;
  await call('/v1/auth/onboard', { token, method: 'POST', body: { tenantName: `Tpl ${label} ${run}` } });
  const id = (await call('/v1/auth/me', { token })).json.tenant.id;
  await admin.from('tenants').update({ plan: 'growth', monthly_email_limit: 100000 }).eq('id', id);
  const domain = `${label}-${run}.test`;
  const d = await call('/v1/domains', { token, method: 'POST', body: { domain } });
  await call(`/v1/domains/${d.json.domain.id}/verify`, { token });
  const from = `billing@${domain}`;
  await call('/v1/sending-addresses', { token, method: 'POST', body: { address: from } });
  return { token, id, from };
}

const A = await tenant('tpla');
const B = await tenant('tplb');

// ── Template CRUD ───────────────────────────────────────────────────────────
const created = await call('/v1/templates', {
  token: A.token,
  method: 'POST',
  body: {
    name: 'Monthly bill',
    subject: 'Your {{month}} bill, {{ first_name | there }}',
    html: '<html><body><p>Hi {{ first_name | there }} from {{company}},</p><p>Total: {{amount}}</p><a href="{{bill_url}}">Download PDF</a></body></html>',
  },
});
check('create template', created.status === 201, `status ${created.status}`);
const tpl = created.json?.template;
check('template lists its merge tags', JSON.stringify(tpl?.mergeTags) === JSON.stringify(['amount', 'bill_url', 'company', 'first_name', 'month']), JSON.stringify(tpl?.mergeTags));

const dup = await call('/v1/templates', { token: A.token, method: 'POST', body: { name: 'Monthly bill', subject: 's', html: '<p>x</p>' } });
check('duplicate name is 409', dup.status === 409, `status ${dup.status}`);

const list = await call('/v1/templates', { token: A.token });
check('list templates', list.json?.templates?.length === 1);
const otherTenant = await call(`/v1/templates/${tpl.id}`, { token: B.token });
check("another tenant can't read the template", otherTenant.status === 404, `status ${otherTenant.status}`);

// ── Contacts with custom fields ─────────────────────────────────────────────
const c1 = `asha-${run}@example.com`;
const c2 = `ravi-${run}@example.com`;
const c3 = `nofields-${run}@example.com`;
const imp = await call('/v1/contacts/import', {
  token: A.token,
  method: 'POST',
  body: {
    contacts: [
      { email: c1, firstName: 'Asha', attributes: { company: 'Acme <Retail>', amount: '₹4,999', bill_url: 'https://files.example.com/asha.pdf' } },
      { email: c2, firstName: 'Ravi', attributes: { company: 'Ravi Traders', amount: '₹1,250', bill_url: 'https://files.example.com/ravi.pdf' } },
      { email: c3 },
    ],
  },
});
check('import contacts with custom fields', imp.status === 201, `status ${imp.status}`);
// Re-importing without fields must not wipe them.
await call('/v1/contacts/import', { token: A.token, method: 'POST', body: { contacts: [{ email: c1, firstName: 'Asha' }] } });
const contacts = (await call('/v1/contacts', { token: A.token })).json.contacts;
check('re-import keeps custom fields', contacts.find((c) => c.email === c1)?.attributes?.company === 'Acme <Retail>');

const preview = await call(`/v1/templates/${tpl.id}/preview`, { token: A.token, method: 'POST', body: { contactEmail: c1, variables: { month: 'October' } } });
check('preview renders contact fields', preview.json?.subject === 'Your October bill, Asha' && preview.json?.html.includes('Acme &lt;Retail&gt;'), preview.json?.subject);
check('preview has a plain-text part', preview.json?.text.includes('Download PDF (https://files.example.com/asha.pdf)'));

// ── Bulk send with a template, personalised per recipient ───────────────────
const send = await call('/v1/send', {
  token: A.token,
  method: 'POST',
  body: { from: A.from, templateId: tpl.id, variables: { month: 'October' }, toEmails: [c1, c2, c3], emailType: 'transactional' },
});
check('send with templateId is accepted', send.status === 202, `status ${send.status} ${send.text.slice(0, 200)}`);

const m1 = await waitForMail(c1);
const m2 = await waitForMail(c2);
const m3 = await waitForMail(c3);
check('each recipient gets their own subject', m1?.Content.Simple.Subject.Data === 'Your October bill, Asha' && m2?.Content.Simple.Subject.Data === 'Your October bill, Ravi');
check('fallback used when a field is missing', m3?.Content.Simple.Subject.Data === 'Your October bill, there');
check('html values are escaped', m1?.Content.Simple.Body.Html.Data.includes('Acme &lt;Retail&gt;'));
// Links in the html are click-tracked; the text part carries them as written.
const m2Text = m2?.Content.Simple.Body.Text?.Data ?? '';
check('each recipient gets their own bill link', m2Text.includes('https://files.example.com/ravi.pdf') && !m2Text.includes('asha.pdf'));
check('plain-text part is sent', (m1?.Content.Simple.Body.Text?.Data ?? '').includes('Total: ₹4,999'));

const { data: jobs } = await admin.from('email_jobs').select('template_id, subject').in('job_id', send.json.jobIds);
check('jobs record the template', jobs?.every((j) => j.template_id === tpl.id) && jobs.some((j) => j.subject === 'Your October bill, Ravi'));

const cross = await call('/v1/send', { token: B.token, method: 'POST', body: { from: B.from, templateId: tpl.id, toEmails: [c1], emailType: 'transactional' } });
check("another tenant can't send with the template", cross.status === 404, `status ${cross.status}`);

// ── /v1/emails with template_id and variables ───────────────────────────────
const key = (await call('/v1/api-keys', { token: A.token, method: 'POST', body: { name: 'tpl', type: 'production' } })).json.key;
const client = `client-${run}@example.com`;
const one = await call('/v1/emails', {
  apiKey: key,
  method: 'POST',
  body: { from: A.from, to: client, template_id: tpl.id, variables: { first_name: 'Meera', company: 'Meera & Co', month: 'November', amount: '₹700', bill_url: 'https://files.example.com/m.pdf' } },
});
check('/v1/emails with template_id is accepted', one.status === 202, `status ${one.status} ${one.text.slice(0, 200)}`);
const m4 = await waitForMail(client);
check('/v1/emails renders variables', m4?.Content.Simple.Subject.Data === 'Your November bill, Meera' && m4?.Content.Simple.Body.Html.Data.includes('Meera &amp; Co'));

const literal = `literal-${run}@example.com`;
await call('/v1/emails', { apiKey: key, method: 'POST', body: { from: A.from, to: literal, subject: 'Code {{x}}', html: '<p>Use {{name}} in templates</p>' } });
const m5 = await waitForMail(literal);
check('inline content without variables keeps literal braces', m5?.Content.Simple.Subject.Data === 'Code {{x}}');

const missing = await call('/v1/emails', { apiKey: key, method: 'POST', body: { from: A.from, to: client, template_id: '00000000-0000-4000-8000-000000000000' } });
check('unknown template is 404', missing.status === 404, `status ${missing.status}`);

// ── Delete ──────────────────────────────────────────────────────────────────
const del = await call(`/v1/templates/${tpl.id}`, { token: A.token, method: 'DELETE' });
const { data: afterDelete } = await admin.from('email_jobs').select('template_id').in('job_id', send.json.jobIds);
check('delete template keeps sent mail history', del.status === 204 && afterDelete?.length === 3 && afterDelete.every((j) => j.template_id === null));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
