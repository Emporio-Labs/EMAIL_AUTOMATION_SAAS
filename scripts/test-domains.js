/**
 * scripts/test-domains.js
 *
 * End-to-end verification of the domain setup:
 *   1. Login as existing user
 *   2. GET  /v1/domains         → list current domains
 *   3. POST /v1/domains         → register a new domain with SES (gets real CNAME tokens)
 *   4. GET  /v1/domains/:id/verify  → poll SES DKIM status
 *   5. POST /v1/send (unverified domain) → expect 403
 *   6. POST /v1/send (no from field)     → expect 400
 *
 * Usage:
 *   node scripts/test-domains.js
 *
 * Requires: API running at localhost:3000  AND  @aws-sdk/client-ses installed
 * Set TEST_EMAIL / TEST_PASSWORD in .env or override below.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL   = 'http://localhost:3000';
const EMAIL      = process.env.TEST_EMAIL    || 'yeshwanthdandu2003@gmail.com';
const PASSWORD   = process.env.TEST_PASSWORD || 'Test@12345678';

// A domain you OWN and want to add to SES.
// Use a real subdomain — SES will issue CNAME tokens for it.
const TEST_DOMAIN = process.env.TEST_DOMAIN || 'mail.fitflix.in';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function ok(label)  { console.log(`  ✅  ${label}`); }
function fail(label, detail) { console.log(`  ❌  ${label}`); console.log('      ', detail); }
function info(label, data)   { console.log(`  ℹ️   ${label}`, typeof data === 'object' ? JSON.stringify(data, null, 4).split('\n').join('\n      ') : data); }
function sep(title) { console.log(`\n${'─'.repeat(60)}\n  ${title}\n${'─'.repeat(60)}`); }

async function api(token, method, path, body) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res  = await fetch(`${BASE_URL}${path}`, opts);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, ok: res.ok, json };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🚀  Domain verification end-to-end test\n');

  // ── Step 0: Login ──────────────────────────────────────────────────────────
  sep('STEP 0 — Login');
  const { data: session, error: loginErr } = await supabase.auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  });

  if (loginErr || !session?.session?.access_token) {
    fail('Login', loginErr?.message || 'no token returned');
    process.exit(1);
  }

  const token = session.session.access_token;
  ok(`Logged in as ${EMAIL}`);

  // ── Step 1: List existing domains ──────────────────────────────────────────
  sep('STEP 1 — GET /v1/domains (list current domains)');
  const listRes = await api(token, 'GET', '/v1/domains');

  if (listRes.ok) {
    ok(`Status ${listRes.status}`);
    info('Existing domains', listRes.json.domains ?? []);
  } else {
    fail(`Status ${listRes.status}`, listRes.json);
  }

  // ── Step 2: Register domain with SES ──────────────────────────────────────
  sep(`STEP 2 — POST /v1/domains (register "${TEST_DOMAIN}" with SES)`);
  const addRes = await api(token, 'POST', '/v1/domains', { domain: TEST_DOMAIN });

  let domainId = null;
  if (addRes.status === 201) {
    ok(`Domain registered — status ${addRes.status}`);
    domainId = addRes.json.domain?.id;
    info('Domain record', addRes.json.domain);
    console.log('\n  📋  CNAME records to publish in your DNS:\n');
    (addRes.json.dnsRecords ?? []).forEach((r, i) => {
      console.log(`      Record ${i + 1}`);
      console.log(`        Type : ${r.type}`);
      console.log(`        Name : ${r.name}`);
      console.log(`        Value: ${r.value}`);
      console.log('');
    });
  } else if (addRes.status === 409) {
    info(`Domain already registered (409). Fetching id from list...`);
    // Pull id from the earlier list response
    const match = (listRes.json.domains ?? []).find(d => d.domain === TEST_DOMAIN);
    if (match) {
      domainId = match.id;
      info('Reusing domain id', domainId);
    } else {
      fail('Could not resolve domain id from list. Re-run after a list refresh.', '');
    }
  } else {
    fail(`Unexpected status ${addRes.status}`, addRes.json);
  }

  // ── Step 3: Check SES DKIM status ─────────────────────────────────────────
  sep('STEP 3 — GET /v1/domains/:id/verify (poll SES DKIM)');
  if (!domainId) {
    fail('Skipped — no domain id available', '');
  } else {
    const verifyRes = await api(token, 'GET', `/v1/domains/${domainId}/verify`);
    if (verifyRes.status === 200 && verifyRes.json.verified === true) {
      ok('DOMAIN IS VERIFIED ✨ — you can now send from this domain!');
      info('Domain record', verifyRes.json.domain);
    } else if (verifyRes.status === 422) {
      info(
        `Not yet verified (expected if you haven't published CNAME records yet)`,
        verifyRes.json.message
      );
      console.log('\n  ⏳  Publish the CNAME records from Step 2, wait for DNS propagation');
      console.log('      (can take minutes to 72 hours), then re-run this script.\n');
    } else {
      fail(`Status ${verifyRes.status}`, verifyRes.json);
    }
  }

  // ── Step 4: Send guard — unverified domain should return 403 ──────────────
  sep('STEP 4 — POST /v1/send with unverified domain (expect 403)');
  const badSendRes = await api(token, 'POST', '/v1/send', {
    from: `no-reply@unregistered-${Date.now()}.com`,
    toEmails: ['test@example.com'],
    subject: 'Guard test',
    html: '<p>This should be blocked.</p>',
  });

  if (badSendRes.status === 403) {
    ok(`403 returned as expected — domain guard is working`);
    info('Error body', badSendRes.json);
  } else {
    fail(`Expected 403, got ${badSendRes.status}`, badSendRes.json);
  }

  // ── Step 5: Send guard — missing "from" should return 400 ─────────────────
  sep('STEP 5 — POST /v1/send without "from" field (expect 400)');
  const noFromRes = await api(token, 'POST', '/v1/send', {
    toEmails: ['test@example.com'],
    subject: 'No from test',
    html: '<p>Missing from.</p>',
  });

  if (noFromRes.status === 400) {
    ok(`400 returned as expected — "from" is now required`);
  } else {
    fail(`Expected 400, got ${noFromRes.status}`, noFromRes.json);
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  sep('SUMMARY');
  console.log('  Domain registration → SES VerifyDomainDkim');
  console.log('  CNAME records printed above for DNS publishing');
  console.log('  Verification check → SES GetIdentityDkimAttributes');
  console.log('  Send guard → 403 for unverified/unregistered domains');
  console.log('  "from" required → 400 when missing\n');
}

main().catch(err => {
  console.error('\n💥  Test runner crashed:', err.message);
  process.exit(1);
});
