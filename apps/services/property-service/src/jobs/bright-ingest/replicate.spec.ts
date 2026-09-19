import type { TokenProvider } from './bright-client';
import { createMemoryStore, createMockResoServer, UNBOUNDED_SCAN_ERROR } from './mock-reso-server';
import { isOrderedWithoutFilter } from './odata-query';
import { replicateResource } from './replicate';
import { resolveResource } from './resources';

const SERVICE_ROOT = 'https://bright-reso.tst.example.test/RESO/OData/bright';
const SERVICE_ROOT_HOST = 'bright-reso.tst.example.test';
const TOKEN_ENDPOINT = 'https://okta.tst.example.test/oauth2/default/v1/token';
const EPOCH = '2026-09-01T00:00:00.000Z';

const tokenProvider: TokenProvider = () =>
  Promise.resolve({ accessToken: 'mock-access-token', expiresInSeconds: 3600 });

/** `n` listings, one minute apart, so ordering and paging are unambiguous. */
function listings(count: number, startIso = '2026-09-02T00:00:00.000Z') {
  const start = Date.parse(startIso);
  return Array.from({ length: count }, (_, i) => ({
    ListingKey: 1000 + i,
    ModificationTimestamp: new Date(start + i * 60_000).toISOString(),
    ListPrice: 500_000 + i,
  }));
}

function run(
  overrides: {
    records?: Record<string, readonly Record<string, unknown>[]>;
    failures?: readonly number[];
    pageSize?: number;
    maxPagesPerRun?: number;
    store?: ReturnType<typeof createMemoryStore>;
  } = {},
) {
  const server = createMockResoServer({
    tokenEndpoint: TOKEN_ENDPOINT,
    serviceRoot: SERVICE_ROOT,
    records: overrides.records ?? { BrightProperties: listings(10) },
    pageSize: overrides.pageSize ?? 4,
    failures: overrides.failures,
  });
  const memory = overrides.store ?? createMemoryStore();

  const invoke = () =>
    replicateResource({
      resource: resolveResource('BrightProperties'),
      serviceRoot: SERVICE_ROOT,
      serviceRootHost: SERVICE_ROOT_HOST,
      tokenProvider,
      store: memory.store,
      runId: '00000000-0000-4000-8000-000000000001',
      initialCursor: EPOCH,
      maxPagesPerRun: overrides.maxPagesPerRun ?? 50,
      pageOptions: { fetchImpl: server.fetchImpl, sleep: () => Promise.resolve(), random: () => 0 },
    });

  return { server, memory, invoke };
}

describe('replicateResource — paging', () => {
  it('follows @odata.nextLink to exhaustion and stages every record', async () => {
    const { server, memory, invoke } = run({ records: { BrightProperties: listings(10) } });

    const result = await invoke();

    expect(result.recordsFetched).toBe(10);
    expect(result.recordsStaged).toBe(10);
    expect(result.pagesFetched).toBe(3);
    expect(result.caughtUp).toBe(true);
    expect(result.cappedByPageLimit).toBe(false);
    expect(result.starved).toBe(false);
    expect(memory.rows.size).toBe(10);
    expect(server.pageRequests).toHaveLength(3);
  });

  /**
   * The rule the whole module is shaped around. It is asserted over what the job actually SENT,
   * including the `@odata.nextLink` URLs, which Bright supplies rather than us.
   */
  it('sends no ordered request without a bounding filter, nextLink pages included', async () => {
    const { server, invoke } = run({ records: { BrightProperties: listings(10) } });
    await invoke();

    expect(server.pageRequests.length).toBeGreaterThan(1);
    for (const url of server.pageRequests) {
      expect(isOrderedWithoutFilter(url)).toBe(false);
      expect(url).toContain('%24filter=');
      expect(url).toContain('%24orderby=');
    }
  });

  /**
   * `$top` is "give me this many and stop", not a page size: with it, Bright returns no
   * `@odata.nextLink`. The mock reproduces that, so a job that sent `$top` would replicate exactly
   * one page and report itself caught up. This is the test that catches it.
   */
  it('sends no $top, so paging is not silently capped at one page', async () => {
    const { server, invoke } = run({ records: { BrightProperties: listings(10) } });
    const result = await invoke();

    for (const url of server.pageRequests) {
      expect(url).not.toContain('%24top=');
    }
    expect(result.pagesFetched).toBeGreaterThan(1);
  });

  /** Bright answers 400 to the OR a strict resume needs, so the job must never send one. */
  it('sends no OR, which this feed rejects as too complex', async () => {
    const memory = createMemoryStore();
    await run({ records: { BrightProperties: listings(6) }, store: memory }).invoke();

    const second = run({ records: { BrightProperties: listings(9) }, store: memory });
    await expect(second.invoke()).resolves.toBeDefined();
    for (const url of second.server.pageRequests) {
      expect(decodeURIComponent(url)).not.toMatch(/\bor\b/i);
    }
  });

  /** The mock refuses an unbounded ordered scan the way Bright does, by never answering. */
  it('the mock rejects an unbounded ordered scan, so the guard cannot be vacuous', async () => {
    const server = createMockResoServer({
      tokenEndpoint: TOKEN_ENDPOINT,
      serviceRoot: SERVICE_ROOT,
      records: { BrightProperties: listings(3) },
    });
    const url = `${SERVICE_ROOT}/BrightProperties?$orderby=ModificationTimestamp asc`;

    await expect(
      server.fetchImpl(url, {
        method: 'GET',
        headers: { Authorization: 'Bearer mock-access-token' },
      }),
    ).rejects.toThrow(UNBOUNDED_SCAN_ERROR);
  });

  it('advances the cursor once per page, not once per run', async () => {
    const { memory, invoke } = run({ records: { BrightProperties: listings(10) } });
    await invoke();

    expect(memory.commits).toHaveLength(3);
    expect(memory.commits.map((commit) => commit.count)).toEqual([4, 4, 2]);
  });
});

describe('replicateResource — resuming', () => {
  /**
   * The filter is inclusive, because Bright rejects the OR that a strict resume needs. So a resumed
   * pass re-reads the records at the watermark instant and writes them over themselves. The row
   * count, not the fetch count, is what must not drift.
   */
  it('reads only the watermark instant and later, and duplicates no row', async () => {
    const memory = createMemoryStore();
    await run({ records: { BrightProperties: listings(6) }, store: memory }).invoke();
    expect(memory.rows.size).toBe(6);

    const result = await run({
      records: { BrightProperties: listings(9) },
      store: memory,
    }).invoke();

    // The 6th record shares the watermark instant, so it comes back with the three new ones.
    expect(result.recordsFetched).toBe(4);
    expect(memory.rows.size).toBe(9);
  });

  /**
   * A crash between the page fetch and the cursor write is the case the transaction exists for. A
   * re-run must not lose a record and must not duplicate one, which the `(resource, record_key)`
   * primary key and the per-page cursor together guarantee.
   */
  it('re-runs over the same data without loss or duplication', async () => {
    const memory = createMemoryStore();
    const data = { BrightProperties: listings(10) };

    await run({ records: data, store: memory }).invoke();
    const second = await run({ records: data, store: memory }).invoke();

    expect(memory.rows.size).toBe(10);
    // Exactly the one record at the watermark instant, re-read and re-written over itself.
    expect(second.recordsFetched).toBe(1);
    expect(second.caughtUp).toBe(true);
  });

  it('stops at the page cap once it has moved on, and resumes next run', async () => {
    const memory = createMemoryStore();
    const data = { BrightProperties: listings(20) };

    const first = await run({
      records: data,
      store: memory,
      pageSize: 4,
      maxPagesPerRun: 2,
    }).invoke();

    expect(first.recordsStaged).toBe(8);
    expect(first.cappedByPageLimit).toBe(true);
    expect(first.caughtUp).toBe(false);
    expect(first.starved).toBe(false);

    const second = await run({ records: data, store: memory, pageSize: 4 }).invoke();
    expect(memory.rows.size).toBe(20);
    expect(second.caughtUp).toBe(true);
  });

  /**
   * The case the conditional page cap exists for. Every record shares one instant, so the cursor
   * cannot advance. A cap applied unconditionally would make every later run re-read the same first
   * pages forever — starvation, not slowness.
   */
  it('crosses a tie block wider than the page cap instead of re-reading it forever', async () => {
    const tied = Array.from({ length: 9 }, (_, i) => ({
      ListingKey: 2000 + i,
      ModificationTimestamp: '2026-09-05T12:00:00.000Z',
      ListPrice: 1,
    }));
    const memory = createMemoryStore();
    const pass = () =>
      run({
        records: { BrightProperties: tied },
        store: memory,
        pageSize: 3,
        maxPagesPerRun: 1,
      }).invoke();

    // The first pass advances off the epoch on page 1, so the cap applies and stops it there.
    const first = await pass();
    expect(first.recordsStaged).toBe(3);
    expect(first.cappedByPageLimit).toBe(true);

    // The second pass starts ON the tie instant. An unconditional cap would stop it at 3 again,
    // forever. Instead it reads the whole block, because the instant never advances.
    const second = await pass();
    expect(second.pagesFetched).toBe(3);
    expect(memory.rows.size).toBe(9);
    expect(second.caughtUp).toBe(true);
    expect(second.starved).toBe(false);
  });

  /** A block wider than the hard cap cannot be crossed. That is a fault and must say so. */
  it('reports starvation when the hard cap is reached with the instant unchanged', async () => {
    const tied = Array.from({ length: 300 }, (_, i) => ({
      ListingKey: 3000 + i,
      ModificationTimestamp: '2026-09-05T12:00:00.000Z',
    }));
    const memory = createMemoryStore();
    // maxPagesPerRun 1 gives a hard cap of 20 pages; 300 records at 1 per page needs 300.
    const pass = () =>
      run({
        records: { BrightProperties: tied },
        store: memory,
        pageSize: 1,
        maxPagesPerRun: 1,
      }).invoke();

    await pass();
    const result = await pass();

    expect(result.starved).toBe(true);
    expect(result.caughtUp).toBe(false);
    expect(result.pagesFetched).toBe(20);
  });

  it('leaves the cursor where it was when a pass finds nothing newer', async () => {
    const memory = createMemoryStore();
    await run({ records: { BrightProperties: listings(3) }, store: memory }).invoke();
    const before = memory.cursors.get('BrightProperties');

    await run({ records: { BrightProperties: listings(3) }, store: memory }).invoke();

    expect(memory.cursors.get('BrightProperties')).toEqual(before);
  });
});

describe('replicateResource — failures', () => {
  it('retries a 429 and counts it', async () => {
    const { invoke } = run({ records: { BrightProperties: listings(2) }, failures: [429, 429] });

    const result = await invoke();

    expect(result.recordsStaged).toBe(2);
    expect(result.retries).toBe(2);
  });

  it('retries a 5xx', async () => {
    const { invoke } = run({ records: { BrightProperties: listings(2) }, failures: [503] });
    await expect(invoke()).resolves.toMatchObject({ recordsStaged: 2, retries: 1 });
  });

  /** A 400 is our query, not Bright's load. Repeating it spends budget and cannot succeed. */
  it('does not retry a 400 and fails the pass', async () => {
    const { invoke } = run({ records: { BrightProperties: listings(2) }, failures: [400] });
    await expect(invoke()).rejects.toThrow(/HTTP 400/);
  });

  /**
   * An `@odata.nextLink` is a server-supplied URL and the next request carries a bearer token. A
   * host change is either a feed misconfiguration or an attempt to collect the credential.
   */
  it('refuses to send the token to a host other than the service root', async () => {
    const hostileFetch = ((url: string) => {
      if (url.includes('$metadata')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: { get: () => null },
          text: () => Promise.resolve(''),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: () => null },
        text: () =>
          Promise.resolve(
            JSON.stringify({
              value: [{ ListingKey: 1, ModificationTimestamp: '2026-09-02T00:00:00.000Z' }],
              '@odata.nextLink': 'https://collector.example.test/page2',
            }),
          ),
      });
    }) as never;
    const memory = createMemoryStore();

    await expect(
      replicateResource({
        resource: resolveResource('BrightProperties'),
        serviceRoot: SERVICE_ROOT,
        serviceRootHost: SERVICE_ROOT_HOST,
        tokenProvider,
        store: memory.store,
        runId: '00000000-0000-4000-8000-000000000002',
        initialCursor: EPOCH,
        maxPagesPerRun: 5,
        pageOptions: { fetchImpl: hostileFetch, sleep: () => Promise.resolve() },
      }),
    ).rejects.toThrow(/Refusing to send the Bright access token to collector.example.test/);
  });

  /**
   * Bright keys are Edm.Int64 and real ones are large — a live `ListingKey` read on 2026-09-19 was
   * 650158656022. Above 2^53 a JSON number is no longer the integer Bright sent, and this value is
   * the staging primary key.
   */
  it('accepts a large key but refuses one outside the exact integer range', async () => {
    const big = run({
      records: {
        BrightProperties: [
          { ListingKey: 650158656022, ModificationTimestamp: '2026-09-02T00:00:00.000Z' },
        ],
      },
    });
    await expect(big.invoke()).resolves.toMatchObject({ recordsStaged: 1 });

    const unsafe = run({
      records: {
        BrightProperties: [
          { ListingKey: 9_007_199_254_740_993, ModificationTimestamp: '2026-09-02T00:00:00.000Z' },
        ],
      },
    });
    await expect(unsafe.invoke()).rejects.toThrow(/outside the exact integer range/);
  });
});
