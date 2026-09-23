import type { FetchLike, TokenProvider } from './bright-client';
import { CrawlFailure, crawlResource } from './crawl';
import { createMemoryStore } from './mock-reso-server';
import { resolveCrawlResource } from './resources';

const SERVICE_ROOT = 'https://bright-reso.tst.example.test/RESO/OData/bright';
const SERVICE_ROOT_HOST = 'bright-reso.tst.example.test';

const tokenProvider: TokenProvider = () =>
  Promise.resolve({ accessToken: 'mock-access-token', expiresInSeconds: 3600 });

/**
 * `n` BrightMedia rows. `ResourceRecordKey` defaults to a sequential `ListingKey`-shaped number, so
 * the default `keepRecordKeys` in `run()` below can keep everything with no extra wiring.
 */
function mediaRecords(
  count: number,
  options: { readonly recordKeyFor?: (i: number) => number | null } = {},
): Record<string, unknown>[] {
  const recordKeyFor = options.recordKeyFor ?? ((i: number) => 9000 + i);
  const start = Date.parse('2026-09-02T00:00:00.000Z');
  return Array.from({ length: count }, (_, i) => {
    const record: Record<string, unknown> = {
      MediaKey: 8000 + i,
      MediaModificationTimestamp: new Date(start + i * 60_000).toISOString(),
    };
    const key = recordKeyFor(i);
    if (key !== null) {
      record.ResourceRecordKey = key;
    }
    return record;
  });
}

function response(status: number, body: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: { get: () => null },
    text: () => Promise.resolve(body),
  };
}

/**
 * A minimal fake of Bright's page endpoint for the unfiltered full-crawl scan.
 *
 * `mock-reso-server.ts` cannot serve this: it requires a `$filter` on every data request and
 * rejects the rest, which is exactly what a crawl never sends. This fake reproduces only the two
 * behaviours the crawl depends on — `@odata.nextLink` paging via `$skiptoken`, and an injectable
 * failure per page — over a plain, unfiltered record list.
 */
function createMediaServer(options: {
  readonly records: readonly Record<string, unknown>[];
  readonly pageSize?: number;
  readonly failures?: readonly number[];
}) {
  const pageSize = options.pageSize ?? 4;
  const failures = [...(options.failures ?? [])];
  const requests: string[] = [];

  const fetchImpl: FetchLike = (url) => {
    requests.push(url);

    const injected = failures.shift();
    if (injected !== undefined && injected > 0) {
      return Promise.resolve(response(injected, JSON.stringify({ error: 'server_error' })));
    }

    const parsed = new URL(url);
    const skip = Number(parsed.searchParams.get('$skiptoken') ?? '0');
    const page = options.records.slice(skip, skip + pageSize);

    const body: Record<string, unknown> = { value: page };
    if (skip + page.length < options.records.length) {
      const next = new URL(url);
      next.searchParams.set('$skiptoken', String(skip + page.length));
      body['@odata.nextLink'] = next.toString();
    }
    return Promise.resolve(response(200, JSON.stringify(body)));
  };

  return { fetchImpl, requests };
}

function run(
  overrides: {
    records?: readonly Record<string, unknown>[];
    keepRecordKeys?: ReadonlySet<string>;
    failures?: readonly number[];
    pageSize?: number;
    maxPagesPerRun?: number;
    store?: ReturnType<typeof createMemoryStore>;
  } = {},
) {
  const records = overrides.records ?? mediaRecords(8);
  const server = createMediaServer({
    records,
    pageSize: overrides.pageSize ?? 4,
    failures: overrides.failures,
  });
  const memory = overrides.store ?? createMemoryStore();
  const keepRecordKeys =
    overrides.keepRecordKeys ??
    new Set(
      records
        .map((record) => record.ResourceRecordKey)
        .filter((key): key is number => key !== undefined)
        .map((key) => String(key)),
    );

  const invoke = () =>
    crawlResource({
      resource: resolveCrawlResource('BrightMedia'),
      serviceRoot: SERVICE_ROOT,
      serviceRootHost: SERVICE_ROOT_HOST,
      tokenProvider,
      store: memory.store,
      feedTier: 'production',
      runId: '00000000-0000-4000-8000-000000000001',
      keepRecordKeys,
      maxPagesPerRun: overrides.maxPagesPerRun ?? 50,
      pageOptions: { fetchImpl: server.fetchImpl, sleep: () => Promise.resolve(), random: () => 0 },
    });

  return { server, memory, invoke };
}

describe('crawlResource — paging', () => {
  it('follows @odata.nextLink to completion and clears the stored link', async () => {
    const { server, memory, invoke } = run({ records: mediaRecords(8), pageSize: 4 });

    const result = await invoke();

    expect(result.pagesFetched).toBe(2);
    expect(result.recordsFetched).toBe(8);
    expect(result.recordsMatched).toBe(8);
    expect(result.recordsStaged).toBe(8);
    expect(result.passComplete).toBe(true);
    expect(result.cappedByPageLimit).toBe(false);
    expect(result.nextLinkStored).toBe(false);
    expect(memory.rows.size).toBe(8);
    expect(server.requests).toHaveLength(2);
    expect(memory.cursors.get('BrightMedia')).toEqual({ modifiedAt: null, recordKey: null });
  });

  it('sends no $filter and no $orderby on any request, first page or nextLink', async () => {
    const { server, invoke } = run({ records: mediaRecords(10), pageSize: 3 });
    await invoke();

    expect(server.requests.length).toBeGreaterThan(1);
    for (const url of server.requests) {
      const decoded = decodeURIComponent(url);
      expect(decoded).not.toContain('$filter');
      expect(decoded).not.toContain('$orderby');
    }
  });
});

describe('crawlResource — resuming', () => {
  it('stores the next link when capped, and the next run resumes without refetching page 1', async () => {
    const memory = createMemoryStore();
    const records = mediaRecords(12);

    const first = run({ records, store: memory, pageSize: 4, maxPagesPerRun: 1 });
    const firstResult = await first.invoke();

    expect(firstResult.pagesFetched).toBe(1);
    expect(firstResult.recordsStaged).toBe(4);
    expect(firstResult.cappedByPageLimit).toBe(true);
    expect(firstResult.passComplete).toBe(false);
    expect(firstResult.nextLinkStored).toBe(true);

    const storedLink = memory.cursors.get('BrightMedia')?.recordKey;
    expect(typeof storedLink).toBe('string');

    const second = run({ records, store: memory, pageSize: 4, maxPagesPerRun: 50 });
    const secondResult = await second.invoke();

    // Resumed straight from the stored link — page 1's URL is never requested again.
    expect(second.server.requests[0]).toBe(storedLink);
    expect(first.server.requests).not.toContain(second.server.requests[0]);
    expect(secondResult.passComplete).toBe(true);
    expect(secondResult.nextLinkStored).toBe(false);
    expect(memory.rows.size).toBe(12);
  });
});

describe('crawlResource — client-side match', () => {
  it('stages only records whose ResourceRecordKey is in keepRecordKeys', async () => {
    const records = mediaRecords(6);
    const { memory, invoke } = run({
      records,
      pageSize: 6,
      keepRecordKeys: new Set(['9001', '9003']),
    });

    const result = await invoke();

    expect(result.recordsFetched).toBe(6);
    expect(result.recordsMatched).toBe(2);
    expect(result.recordsStaged).toBe(2);
    expect(memory.rows.size).toBe(2);
  });

  it('drops a record with a null or absent ResourceRecordKey', async () => {
    const records = [
      ...mediaRecords(2, { recordKeyFor: () => null }),
      ...mediaRecords(2, { recordKeyFor: (i) => 9100 + i }),
    ];
    // The two records with no key can never match, whatever this set names.
    const keepRecordKeys = new Set(['9100', '9101']);
    const { memory, invoke } = run({ records, pageSize: 4, keepRecordKeys });

    const result = await invoke();

    expect(result.recordsFetched).toBe(4);
    expect(result.recordsMatched).toBe(2);
    expect(result.recordsStaged).toBe(2);
    expect(memory.rows.size).toBe(2);
  });

  /**
   * A matched record with an unusable MediaKey (missing, or a non-safe-integer number) must be
   * skipped and counted, never thrown. This scan has no timestamp to resume past a bad page — a
   * throw here would wedge the pass on the stored @odata.nextLink forever, since the next run
   * resumes at the same page and hits the same record again.
   */
  it('skips a record with an unusable own key, stages the rest, and completes', async () => {
    const records = [
      {
        MediaKey: 8000,
        ResourceRecordKey: 9000,
        MediaModificationTimestamp: '2026-09-02T00:00:00Z',
      },
      // A non-safe-integer MediaKey is unusable as a staging primary key.
      {
        MediaKey: 8001.5,
        ResourceRecordKey: 9001,
        MediaModificationTimestamp: '2026-09-02T00:01:00Z',
      },
      {
        MediaKey: 8002,
        ResourceRecordKey: 9002,
        MediaModificationTimestamp: '2026-09-02T00:02:00Z',
      },
    ];
    const { memory, invoke } = run({
      records,
      pageSize: 3,
      keepRecordKeys: new Set(['9000', '9001', '9002']),
    });

    const result = await invoke();

    expect(result.recordsFetched).toBe(3);
    expect(result.recordsMatched).toBe(3);
    expect(result.recordsSkipped).toBe(1);
    expect(result.recordsStaged).toBe(2);
    expect(result.passComplete).toBe(true);
    expect(memory.rows.size).toBe(2);
  });
});

describe('crawlResource — failures', () => {
  /** A 400 is not retried, so the second page fails immediately and the first stays staged. */
  it('reports partial progress when a later page fails', async () => {
    const { invoke } = run({
      records: mediaRecords(8),
      pageSize: 4,
      failures: [0, 400],
    });

    let thrown: unknown;
    try {
      await invoke();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CrawlFailure);
    const failure = thrown as CrawlFailure;
    expect(failure.partial.pagesFetched).toBe(1);
    expect(failure.partial.recordsStaged).toBe(4);
    expect(failure.partial.passComplete).toBe(false);
  });
});
