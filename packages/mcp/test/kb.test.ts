import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { clearKbCache, sanitizeQuery } from '../src/kb/client.ts';
import { handler as kbSearch } from '../src/tools/kb-search.ts';
import { fakeDeps } from './helpers.ts';

const PASSAGES = {
  passages: [
    {
      docId: 'i1040gi',
      section: 'Line 1a',
      text: 'Enter the total of your wages from Form(s) W-2, box 1.',
      sourceUrl: 'https://www.irs.gov/instructions/i1040gi',
      revisionDate: '2025-12-01',
    },
  ],
};

function recordingFetch(body: unknown = PASSAGES, status = 200) {
  const urls: string[] = [];
  const fn = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { fn, urls };
}

beforeEach(() => {
  clearKbCache();
  process.env.KIT1040_KB_URL = 'https://kb.test/kb/search';
});

test('kb_search strips PII before sending', async () => {
  const f = recordingFetch();
  const r = await kbSearch(
    {
      query:
        'Can I deduct my home office? my ssn is 123-45-6789, ein 12-3456789, acct 000123456789, {{SSN:taxpayer}} paid $1,234.56',
      taxYear: 2025,
    },
    fakeDeps({ kbFetch: f.fn })
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(f.urls.length, 1);
  const url = new URL(f.urls[0]!);
  assert.equal(url.origin + url.pathname, 'https://kb.test/kb/search');
  assert.equal(url.searchParams.get('ty'), '2025');
  assert.equal(url.searchParams.get('k'), '5');
  const q = url.searchParams.get('q')!;
  assert.ok(!/\d{3}-?\d{2}-?\d{4}/.test(f.urls[0]!), f.urls[0]!);
  assert.ok(!/\d{9}/.test(decodeURIComponent(f.urls[0]!)));
  assert.ok(!q.includes('{{'), q);
  assert.ok(!q.includes('1,234.56'), q);
  assert.match(q, /home office/);
  assert.equal(r.passages[0]!.docId, 'i1040gi');
});

test('caches identical queries', async () => {
  const f = recordingFetch();
  const deps = fakeDeps({ kbFetch: f.fn });
  await kbSearch({ query: 'What is QBI?', taxYear: 2025 }, deps);
  await kbSearch({ query: '  what is   qbi? ', taxYear: 2025 }, deps);
  assert.equal(f.urls.length, 1);
  await kbSearch({ query: 'What is QBI?', taxYear: 2026 }, deps);
  assert.equal(f.urls.length, 2);
});

test('unavailable is a soft error', async () => {
  const down = (async () => {
    throw new TypeError('fetch failed');
  }) as typeof fetch;
  const r = await kbSearch(
    { query: 'standard deduction', taxYear: 2025 },
    fakeDeps({ kbFetch: down })
  );
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.error.code, 'KB_UNAVAILABLE');
  const bad = recordingFetch({ nope: true });
  const r2 = await kbSearch(
    { query: 'standard deduction 2', taxYear: 2025 },
    fakeDeps({ kbFetch: bad.fn })
  );
  assert.equal(!r2.ok && r2.error.code, 'KB_UNAVAILABLE');
  const err = recordingFetch(PASSAGES, 503);
  const r3 = await kbSearch(
    { query: 'standard deduction 3', taxYear: 2025 },
    fakeDeps({ kbFetch: err.fn })
  );
  assert.equal(!r3.ok && r3.error.code, 'KB_UNAVAILABLE');
});

test('rejects over-long query', async () => {
  const f = recordingFetch();
  const r = await kbSearch(
    { query: 'x'.repeat(501), taxYear: 2025 },
    fakeDeps({ kbFetch: f.fn })
  );
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.error.code, 'QUERY_TOO_LONG');
  assert.equal(f.urls.length, 0);
});

test('a query that is only PII is refused without a call', async () => {
  const f = recordingFetch();
  const r = await kbSearch(
    { query: '123-45-6789', taxYear: 2025 },
    fakeDeps({ kbFetch: f.fn })
  );
  assert.equal(!r.ok && r.error.code, 'QUERY_EMPTY');
  assert.equal(f.urls.length, 0);
  assert.equal(
    sanitizeQuery('Is $50.00 of tips taxable?'),
    'Is of tips taxable?'
  );
});
