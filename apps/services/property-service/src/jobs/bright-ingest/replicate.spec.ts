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
    resource?: string;
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
      resource: resolveResource(overrides.resource ?? 'BrightProperties'),
      serviceRoot: SERVICE_ROOT,
      serviceRootHost: SERVICE_ROOT_HOST,
      tokenProvider,
      store: memory.store,
      runId: '00000000-0000-4000-8000-000000000001',
      initialCursor: EPOCH,
      pageSize: overrides.pageSize ?? 4,
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

  /** The mock refuses an unbounded ordered scan the way Bright effectively does, by never answering. */
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
  it('reads only what changed since the stored cursor, and re-reads nothing', async () => {
    const memory = createMemoryStore();
    const first = run({ records: { BrightProperties: listings(6) }, store: memory });
    await first.invoke();
    expect(memory.rows.size).toBe(6);

    const second = run({ records: { BrightProperties: listings(9) }, store: memory });
    const result = await second.invoke();

    expect(result.recordsFetched).toBe(3);
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
    // The boundary record shares the cursor instant, so the strict (instant, key) predicate
    // excludes it rather than re-reading it.
    expect(second.recordsFetched).toBe(0);
    expect(second.caughtUp).toBe(true);
  });

  /**
   * A tie block wider than a page is the case a timestamp-only cursor starves on: a capped run
   * would re-read the same block forever and never pass it.
   */
  it('passes a tie block wider than one page', async () => {
    const tied = Array.from({ length: 9 }, (_, i) => ({
      ListingKey: 2000 + i,
      ModificationTimestamp: '2026-09-05T12:00:00.000Z',
      ListPrice: 1,
    }));
    const memory = createMemoryStore();

    const first = await run({
      records: { BrightProperties: tied },
      store: memory,
      pageSize: 3,
      maxPagesPerRun: 1,
    }).invoke();
    expect(first.recordsStaged).toBe(3);
    expect(first.cappedByPageLimit).toBe(true);

    const second = await run({
      records: { BrightProperties: tied },
      store: memory,
      pageSize: 3,
      maxPagesPerRun: 1,
    }).invoke();
    expect(second.recordsStaged).toBe(3);
    expect(memory.rows.size).toBe(6);

    const third = await run({
      records: { BrightProperties: tied },
      store: memory,
      pageSize: 3,
      maxPagesPerRun: 5,
    }).invoke();
    expect(memory.rows.size).toBe(9);
    expect(third.caughtUp).toBe(true);
  });

  it('stops at the page cap, reports it, and resumes from the cursor next run', async () => {
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

    const second = await run({ records: data, store: memory, pageSize: 4 }).invoke();
    expect(memory.rows.size).toBe(20);
    expect(second.caughtUp).toBe(true);
  });

  it('leaves the cursor untouched when a pass returns nothing', async () => {
    const memory = createMemoryStore();
    await run({ records: { BrightProperties: listings(3) }, store: memory }).invoke();
    const before = memory.cursors.get('BrightProperties');

    await run({ records: { BrightProperties: listings(3) }, store: memory }).invoke();

    expect(memory.cursors.get('BrightProperties')).toEqual(before);
  });
});

describe('replicateResource — resources are configuration, not forks', () => {
  it('replicates BrightMedia on MediaModificationTimestamp', async () => {
    const media = [
      {
        MediaKey: 77,
        MediaModificationTimestamp: '2026-09-03T00:00:00.000Z',
        MediaURL: 'https://cdn.example.test/1.jpg',
      },
    ];
    const { server, memory, invoke } = run({
      records: { BrightMedia: media },
      resource: 'BrightMedia',
    });

    const result = await invoke();

    expect(result.recordsStaged).toBe(1);
    expect(memory.rows.get('BrightMedia\u000077')).toBeDefined();
    expect(server.pageRequests[0]).toContain('MediaModificationTimestamp');
  });

  it('replicates Deletion on DeletionTimestamp and reports it as deletions', async () => {
    const deletions = [
      { UniversalKey: 31, DeletionTimestamp: '2026-09-04T00:00:00.000Z', TableName: 'Property' },
    ];
    const { memory, invoke } = run({ records: { Deletion: deletions }, resource: 'Deletion' });

    const result = await invoke();

    expect(result.kind).toBe('deletions');
    expect(result.recordsStaged).toBe(1);
    expect(memory.rows.get('Deletion\u000031')).toBeDefined();
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
    const hostile = {
      fetchImpl: ((url: string) => {
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
      }) as never,
    };
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
        pageSize: 10,
        maxPagesPerRun: 5,
        pageOptions: { fetchImpl: hostile.fetchImpl, sleep: () => Promise.resolve() },
      }),
    ).rejects.toThrow(/Refusing to send the Bright access token to collector.example.test/);
  });

  /**
   * Bright keys are Edm.Int64. Above 2^53 a JSON number is not the integer Bright sent, and this
   * value is the staging primary key and the cursor tiebreak.
   */
  it('refuses a key outside the exact integer range of a JSON number', async () => {
    const { invoke } = run({
      records: {
        BrightProperties: [
          { ListingKey: 9_007_199_254_740_993, ModificationTimestamp: '2026-09-02T00:00:00.000Z' },
        ],
      },
    });

    await expect(invoke()).rejects.toThrow(/outside the exact integer range/);
  });
});
