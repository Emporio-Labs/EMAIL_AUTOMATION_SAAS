// Run with: npm test
// Covers the pure parts of the OTP API. Dummy env vars are set before
// importing modules that validate env at load time.
Object.assign(process.env, {
  SUPABASE_URL: 'http://localhost:54321',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  SQS_QUEUE_URL: 'http://localhost:9324/queue/test',
  INTERNAL_KEY: 'x'.repeat(32),
  PLATFORM_FROM_EMAIL: 'noreply@example.com',
  PLATFORM_FROM_NAME: 'Test',
  BASE_URL: 'http://localhost:3000',
  OTP_SENDING_DOMAIN: 'otp-mail.in',
});

import { test } from 'node:test';
import assert from 'node:assert/strict';

test('generateOtpCode returns digits of the requested length', async () => {
  const { generateOtpCode } = await import('../src/lib/otp');
  for (const length of [4, 6, 8]) {
    const code = generateOtpCode(length);
    assert.match(code, new RegExp(`^\\d{${length}}$`));
  }
  const seen = new Set(Array.from({ length: 200 }, () => generateOtpCode(6)));
  assert.ok(seen.size > 190, 'codes should not repeat often');
});

test('hashOtpCode is bound to the code id and never contains the code', async () => {
  const { hashOtpCode } = await import('../src/lib/otp');
  const a = hashOtpCode('id-1', '123456');
  assert.equal(a, hashOtpCode('id-1', '123456'));
  assert.notEqual(a, hashOtpCode('id-2', '123456'));
  assert.notEqual(a, hashOtpCode('id-1', '123457'));
  assert.ok(!a.includes('123456'));
});

test('normalizeOtpInput strips spaces and dashes', async () => {
  const { normalizeOtpInput } = await import('../src/lib/otp');
  assert.equal(normalizeOtpInput(' 123 456 '), '123456');
  assert.equal(normalizeOtpInput('123-456'), '123456');
});

test('renderOtpEmail puts the code in the subject and escapes the app name', async () => {
  const { renderOtpEmail } = await import('../src/lib/otp');
  const mail = renderOtpEmail({ code: '482913', appName: 'Acme <Pay>', ttlMinutes: 10 });
  assert.equal(mail.subject, '482913 is your Acme <Pay> verification code');
  assert.match(mail.text, /482913/);
  assert.match(mail.text, /expires in 10 minutes/);
  assert.match(mail.html, /Acme &lt;Pay&gt;/);
  assert.ok(!/<img|href=/i.test(mail.html), 'no tracking pixel or links');
});

test('subdomain labels are valid hostnames', async () => {
  const { toSubdomainLabel, validateSubdomainLabel, defaultOtpSender } = await import('../src/lib/otp');
  assert.equal(toSubdomainLabel('X_Company Pvt. Ltd'), 'x-company-pvt-ltd');
  assert.equal(toSubdomainLabel('__'), null);
  assert.equal(validateSubdomainLabel('xcompany'), null);
  assert.notEqual(validateSubdomainLabel('x_company'), null);
  assert.notEqual(validateSubdomainLabel('-abc'), null);
  assert.notEqual(validateSubdomainLabel('admin'), null);
  assert.equal(defaultOtpSender('xcompany'), 'noreply@xcompany.otp-mail.in');
});

test('verifyCaptcha posts the secret and token and reads success', async () => {
  const { verifyCaptcha } = await import('../src/lib/otp');
  let sent: { url: string; body: string } | null = null;
  const fakeFetch = (async (url: string, init: RequestInit) => {
    sent = { url, body: String(init.body) };
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }) as unknown as typeof fetch;

  assert.equal(await verifyCaptcha('turnstile', 'sec', 'tok', '1.2.3.4', fakeFetch), true);
  assert.equal(sent!.url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  assert.equal(sent!.body, 'secret=sec&response=tok&remoteip=1.2.3.4');

  const failing = (async () => new Response(JSON.stringify({ success: false }), { status: 200 })) as unknown as typeof fetch;
  assert.equal(await verifyCaptcha('hcaptcha', 'sec', 'tok', undefined, failing), false);
  const throwing = (async () => { throw new Error('network'); }) as unknown as typeof fetch;
  assert.equal(await verifyCaptcha('hcaptcha', 'sec', 'tok', undefined, throwing), false);
});

test('evaluateOtpBounces warns, pauses, and ignores small samples', async () => {
  const { evaluateOtpBounces } = await import('../src/lib/otp');
  assert.equal(evaluateOtpBounces({ sent: 10, bounced: 5, complained: 0 }).verdict, 'ok');
  assert.equal(evaluateOtpBounces({ sent: 100, bounced: 1, complained: 0 }).verdict, 'ok');
  assert.equal(evaluateOtpBounces({ sent: 100, bounced: 3, complained: 0 }).verdict, 'warning');
  assert.equal(evaluateOtpBounces({ sent: 100, bounced: 5, complained: 0 }).verdict, 'pause');
  assert.equal(evaluateOtpBounces({ sent: 100, bounced: 0, complained: 1 }).verdict, 'ok');
  assert.equal(evaluateOtpBounces({ sent: 100, bounced: 0, complained: 2 }).verdict, 'pause');
});
