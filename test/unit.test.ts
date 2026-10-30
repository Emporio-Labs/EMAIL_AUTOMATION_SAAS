import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, fromBase64Url, rewriteLinks, signClickUrl, verifyClickUrl } from '../src/lib/tracker';

const SECRET = 'x'.repeat(32);
const JOB = 'e3b0c442-98fc-11eb-a8b3-0242ac130003';

test('rewriteLinks signs tracked links and decodes &amp;', () => {
  const html = '<a href="https://example.com/?a=1&amp;b=2">x</a>';
  const out = rewriteLinks(html, JOB, 'https://api.test', SECRET);
  const match = out.match(/\/t\/c\/([^/]+)\/([^/]+)\/([^"]+)"/);
  assert.ok(match, out);
  const [, jobId, encoded, signature] = match;
  assert.equal(jobId, JOB);
  assert.equal(fromBase64Url(encoded), 'https://example.com/?a=1&b=2');
  assert.ok(verifyClickUrl(JOB, 'https://example.com/?a=1&b=2', signature, SECRET));
});

test('rewriteLinks leaves mailto, relative and unsubscribe links alone', () => {
  const html = '<a href="mailto:a@b.c">m</a><a href="/x">r</a><a href="https://s.test/v1/unsubscribe?t=1">u</a>';
  assert.equal(rewriteLinks(html, JOB, 'https://api.test', SECRET), html);
});

test('verifyClickUrl rejects a different URL or job', () => {
  const sig = signClickUrl(JOB, 'https://good.test', SECRET);
  assert.equal(verifyClickUrl(JOB, 'https://evil.test', sig, SECRET), false);
  assert.equal(verifyClickUrl('11111111-1111-1111-1111-111111111111', 'https://good.test', sig, SECRET), false);
  assert.equal(verifyClickUrl(JOB, 'https://good.test', 'short', SECRET), false);
});

test('escapeHtml escapes markup', () => {
  assert.equal(escapeHtml('<b>"A&B"</b>'), '&lt;b&gt;&quot;A&amp;B&quot;&lt;/b&gt;');
});

test('SQS batching respects 10 entries and the size cap', async () => {
  Object.assign(process.env, {
    SUPABASE_URL: 'http://localhost', SUPABASE_ANON_KEY: 'a', SUPABASE_SERVICE_ROLE_KEY: 'a',
    SQS_QUEUE_URL: 'http://localhost/q', INTERNAL_KEY: SECRET, PLATFORM_FROM_EMAIL: 'a@b.co',
    PLATFORM_FROM_NAME: 'x', BASE_URL: 'http://localhost',
  });
  const { __test__ } = await import('../src/lib/sqs');
  const small = Array.from({ length: 25 }, (_, i) => ({ jobId: `j${i}`, body: 'x' }));
  assert.deepEqual(__test__.chunkForSqs(small).batches.map((b) => b.length), [10, 10, 5]);

  const big = Array.from({ length: 3 }, (_, i) => ({ jobId: `b${i}`, body: 'x'.repeat(100 * 1024) }));
  assert.deepEqual(__test__.chunkForSqs(big).batches.map((b) => b.length), [2, 1]);

  const huge = [{ jobId: 'h', body: 'x'.repeat(300 * 1024) }];
  const result = __test__.chunkForSqs(huge);
  assert.equal(result.batches.length, 0);
  assert.equal(result.oversized[0].jobId, 'h');
});

test('rate limiter allows up to the limit per minute', async () => {
  const { tryConsume, resetRateLimits } = await import('../src/utils/rate-limiter');
  resetRateLimits();
  assert.equal(tryConsume('t', 4, 5, 0), true);
  assert.equal(tryConsume('t', 2, 5, 1000), false);
  assert.equal(tryConsume('t', 1, 5, 1000), true);
  assert.equal(tryConsume('t', 5, 5, 61_000), true);
  assert.equal(tryConsume('other', 5, 5, 1000), true);
});
