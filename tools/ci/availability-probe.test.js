'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const {
  parseConfig,
  percentile,
  longestErrorStreak,
  summarize,
  renderMarkdown,
  firstListingId,
  buildTargets,
  timedRead,
  trimBase,
  buildHeaders,
} = require('./availability-probe');

const s = (status, ms = 10) => ({ status, ms });

test('#963: percentile uses nearest rank and handles empty input', () => {
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([5, 1, 3, 2, 4], 50), 3);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95), 10);
  assert.equal(percentile([7], 95), 7);
});

test('#963: longest error streak counts consecutive non-200 reads', () => {
  assert.equal(longestErrorStreak([]), 0);
  assert.equal(longestErrorStreak([s(200), s(200)]), 0);
  assert.equal(longestErrorStreak([s(200), s(502), s(0), s(429), s(200), s(500)]), 3);
});

test('#963: summarize counts statuses and latency', () => {
  const r = summarize([s(200, 100), s(200, 200), s(502, 900), s(0, 10000)]);
  assert.deepEqual(r.byStatus, { 0: 1, 200: 2, 502: 1 });
  assert.equal(r.total, 4);
  assert.equal(r.nonOk, 2);
  assert.equal(r.p50, 200);
  assert.equal(r.max, 10000);
  assert.equal(r.longestErrorStreak, 2);
});

test('#963: config clamps duration to 3600 s and interval to at least 2 s', () => {
  assert.deepEqual(parseConfig({ DURATION_SECONDS: '99999', INTERVAL_SECONDS: '0' }), {
    durationSeconds: 3600,
    intervalSeconds: 2,
  });
  assert.deepEqual(parseConfig({}), { durationSeconds: 600, intervalSeconds: 2 });
  assert.equal(parseConfig({ DURATION_SECONDS: 'abc' }).durationSeconds, 600);
});

test('#963: the markdown report names the failing reads and holds no URL', () => {
  const md = renderMarkdown(
    { 'web home page': [s(200), s(200)], 'gateway home-row read': [s(200), s(502)] },
    { durationSeconds: 60, intervalSeconds: 2, deployAtSeconds: 30 },
  );
  assert.match(md, /\| gateway home-row read \| 2 \| 200: 1, 502: 1 \| 1 \|/);
  assert.match(md, /1 non-200 reads/);
  assert.doesNotMatch(md, /https?:/);
});

test('#963: listing id is read from the first result only', () => {
  assert.equal(firstListingId({ results: [{ propertyId: 'abc' }, { propertyId: 'x' }] }), 'abc');
  assert.equal(firstListingId({ results: [] }), null);
  assert.equal(firstListingId(null), null);
});

test('#963: targets use the home-row query the home page sends', () => {
  const t = buildTargets({ webBase: 'https://w', gatewayBase: 'https://g', listingId: 'a/b' });
  assert.equal(t.length, 5);
  assert.equal(
    t[3].url,
    'https://g/property/listings?listingType=sale&sort=newly-listed&pageSize=15&skipTotal=true',
  );
  assert.equal(t[4].url, 'https://g/property/listings/a%2Fb');
});

test('#963: trimBase strips trailing slashes', () => {
  assert.equal(trimBase('http://api-gateway-svc:8080/'), 'http://api-gateway-svc:8080');
});

test('#963: the probe sends its own IP for the gateway rate limit key', () => {
  const h = buildHeaders('10.1.2.3');
  assert.equal(h['X-Real-IP'], '10.1.2.3');
  assert.equal(h['X-Forwarded-For'], '10.1.2.3');
  assert.equal(buildHeaders(undefined)['X-Real-IP'], undefined);
});

test('#963: timedRead reports a status, and status 0 on a network error', async () => {
  const server = http.createServer((req, res) => {
    res.statusCode = req.url === '/bad' ? 503 : 200;
    res.end('ok');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    assert.equal((await timedRead(`http://127.0.0.1:${port}/`, {})).status, 200);
    assert.equal((await timedRead(`http://127.0.0.1:${port}/bad`, {})).status, 503);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  const down = await timedRead(`http://127.0.0.1:${port}/`, {});
  assert.equal(down.status, 0);
});
