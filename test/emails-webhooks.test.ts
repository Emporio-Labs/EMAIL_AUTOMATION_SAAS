// Run with: npm test
// Covers the pure parts of the send API and webhook signing. Dummy env vars
// are set before importing modules that validate env at load time.
Object.assign(process.env, {
  SUPABASE_URL: 'http://localhost:54321',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  SQS_QUEUE_URL: 'http://localhost:9324/queue/test',
  INTERNAL_KEY: 'x'.repeat(32),
  PLATFORM_FROM_EMAIL: 'noreply@example.com',
  PLATFORM_FROM_NAME: 'Test',
  BASE_URL: 'http://localhost:3000',
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import http from 'http';
import type { AddressInfo } from 'net';

test('signWebhookPayload produces a verifiable HMAC over "<t>.<body>"', async () => {
  const { signWebhookPayload } = await import('../src/lib/webhooks');
  const header = signWebhookPayload('whsec_test', '{"a":1}', 1700000000);
  const expected = crypto.createHmac('sha256', 'whsec_test').update('1700000000.{"a":1}').digest('hex');
  assert.equal(header, `t=1700000000,v1=${expected}`);
});

test('validateWebhookUrl rejects non-URLs and non-http schemes', async () => {
  const { validateWebhookUrl } = await import('../src/lib/webhooks');
  assert.equal(validateWebhookUrl('https://hooks.example.com/swayam'), null);
  assert.notEqual(validateWebhookUrl('not a url'), null);
  assert.notEqual(validateWebhookUrl('ftp://example.com'), null);
});

test('postWebhook sends signed JSON with event headers', async () => {
  const { postWebhook, buildWebhookBody } = await import('../src/lib/webhooks');
  let received: { headers: http.IncomingHttpHeaders; body: string } | null = null;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { received = { headers: req.headers, body }; res.writeHead(204).end(); });
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as AddressInfo).port;

  const body = buildWebhookBody({ id: 'd1', event_type: 'email.delivered', created_at: '2026-10-30T00:00:00Z', payload: { email_id: 'e1' } });
  const status = await postWebhook(`http://127.0.0.1:${port}/hook`, 'whsec_test', 'd1', 'email.delivered', body);
  server.close();

  assert.equal(status, 204);
  assert.ok(received);
  const { headers, body: got } = received!;
  assert.equal(headers['swayam-event'], 'email.delivered');
  assert.equal(headers['swayam-delivery-id'], 'd1');
  assert.deepEqual(JSON.parse(got), { id: 'd1', type: 'email.delivered', created_at: '2026-10-30T00:00:00Z', data: { email_id: 'e1' } });

  const [, t, v1] = /^t=(\d+),v1=([0-9a-f]+)$/.exec(String(headers['swayam-signature']))!;
  const expected = crypto.createHmac('sha256', 'whsec_test').update(`${t}.${got}`).digest('hex');
  assert.equal(v1, expected);
});

test('renderAttachmentCards escapes filenames and links each file', async () => {
  const { renderAttachmentCards } = await import('../src/routes/emails');
  const html = renderAttachmentCards([
    { filename: 'Invoice <Oct>.pdf', url: 'https://files.example.com/inv.pdf?a=1&b=2' },
    { filename: 'report.xlsx', url: 'https://files.example.com/r.xlsx' },
  ]);
  assert.match(html, /2 attachments/);
  assert.match(html, /Invoice &lt;Oct&gt;\.pdf/);
  assert.match(html, /href="https:\/\/files\.example\.com\/inv\.pdf\?a=1&amp;b=2"/);
  assert.match(html, />PDF</);
  assert.match(html, />XLSX</);
});
