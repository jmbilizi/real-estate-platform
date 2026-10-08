import type { BrightPage } from '../bright-ingest/bright-client';
import type { ListingStatusLookup } from '../bright-map/status';

import { PROBE_BATCH_SIZE, runProbeSweep } from './probe';

const ROOT = 'https://bright-reso.brightmls.com/RESO/OData/bright';

const STATUSES: ListingStatusLookup[] = [
  ['Active', 'Active', false, 'Active', true],
  ['Coming Soon', 'Coming Soon', false, 'ComingSoon', true],
  ['Pending', 'Pending', false, 'Pending', true],
  ['Closed', 'Sold', true, 'Closed', false],
  ['Canceled', null, true, 'Canceled', false],
  ['Withdrawn', null, true, 'Withdrawn', false],
  ['Expired', null, true, 'Expired', false],
  ['Delete', null, true, 'Delete', false],
].map(([code, consumerStatus, isTerminal, reso, searchable]) => ({
  code: code as string,
  consumerStatus: consumerStatus as ListingStatusLookup['consumerStatus'],
  isTerminal: isTerminal as boolean,
  resoStandardStatus: reso as string,
  isPubliclySearchable: searchable as boolean,
}));

/** Bright holds `feed`: key to StandardStatus. A key not in `feed` is absent. */
function harness(
  localKeys: string[],
  feed: Record<string, string>,
  override?: (url: string, keys: string[]) => BrightPage | Error | undefined,
  maxTakedown = 500,
) {
  const live = new Map(localKeys.map((key) => [key, `id-${key}`]));
  const urls: string[] = [];
  const taken: string[][] = [];
  const logs: string[] = [];
  const fetchPage = (url: string): Promise<BrightPage> => {
    urls.push(url);
    const filter = new URL(url).searchParams.get('$filter') ?? '';
    const keys = [...filter.matchAll(/\d+/g)].map((m) => m[0]);
    const forced = override?.(url, keys);
    if (forced instanceof Error) return Promise.reject(forced);
    if (forced !== undefined) return Promise.resolve(forced);
    const records = keys
      .filter((key) => key in feed)
      .map((key) => ({ ListingKey: Number(key), StandardStatus: feed[key] }));
    return Promise.resolve({ records, nextLink: null, count: records.length });
  };
  const run = () =>
    runProbeSweep(
      {
        serviceRoot: ROOT,
        fetchPage,
        listLive: () => Promise.resolve(live),
        takeDown: (ids) => {
          taken.push([...ids]);
          return Promise.resolve(ids.length);
        },
        statuses: STATUSES,
        concurrency: 3,
        log: (m) => logs.push(m),
      },
      { maxTakedown },
    );
  return { run, urls, taken, logs };
}

describe('runProbeSweep', () => {
  it('keeps a key Bright returns live and takes down a key Bright omits (AC 2, 4)', async () => {
    const h = harness(['1', '2', '3'], { '1': 'Active', '3': 'ComingSoon' });
    const report = await h.run();

    expect(h.taken).toEqual([['id-2']]);
    expect(report).toMatchObject({ checked: 3, kept: 2, takenDown: 1, errors: 0, aborted: false });
  });

  it('takes down a key Bright returns in a status search does not show (AC 2)', async () => {
    const feed = {
      '1': 'Closed',
      '2': 'Canceled',
      '3': 'Withdrawn',
      '4': 'Expired',
      '5': 'Delete',
      '6': 'Pending',
      '7': 'SomethingNew',
    };
    const h = harness(['1', '2', '3', '4', '5', '6', '7'], feed);
    const report = await h.run();

    expect(h.taken[0]?.sort()).toEqual(['id-1', 'id-2', 'id-3', 'id-4', 'id-5', 'id-7']);
    expect(report).toMatchObject({ kept: 1, takenDown: 6 });
  });

  it('batches with the `in` filter and never sends `or` (AC 12)', async () => {
    const keys = Array.from({ length: PROBE_BATCH_SIZE * 2 + 1 }, (_, i) => String(1000 + i));
    const h = harness(keys, Object.fromEntries(keys.map((k) => [k, 'Active'])));
    await h.run();

    expect(h.urls).toHaveLength(3);
    for (const url of h.urls) {
      const filter = new URL(url).searchParams.get('$filter') ?? '';
      expect(filter).toMatch(/^ListingKey in \(\d+(,\d+)*\)$/);
      expect(filter).not.toMatch(/ or /);
    }
  });

  it('leaves a batch live when the request fails (AC 5)', async () => {
    const h = harness(['1', '2'], {}, () => new Error('HTTP 503'));

    await expect(h.run()).rejects.toThrow(/every batch failed/);
    expect(h.taken).toEqual([]);
  });

  it('leaves a batch live when the answer is truncated or malformed (AC 5)', async () => {
    const cases: Array<[string, BrightPage]> = [
      ['next page', { records: [], nextLink: `${ROOT}/BrightProperties?$skiptoken=1` }],
      ['count mismatch', { records: [], nextLink: null, count: 2 }],
      [
        'unrequested key',
        { records: [{ ListingKey: 99, StandardStatus: 'Active' }], nextLink: null, count: 1 },
      ],
      [
        'too many records',
        {
          records: [
            { ListingKey: 1, StandardStatus: 'Active' },
            { ListingKey: 2, StandardStatus: 'Active' },
            { ListingKey: 1, StandardStatus: 'Active' },
          ],
          nextLink: null,
        },
      ],
    ];
    for (const [, page] of cases) {
      const h = harness(['1', '2'], {}, () => page);
      await expect(h.run()).rejects.toThrow(/every batch failed/);
      expect(h.taken).toEqual([]);
    }
  });

  it('keeps the other batches working when one batch fails (AC 5)', async () => {
    const keys = Array.from({ length: PROBE_BATCH_SIZE + 2 }, (_, i) => String(1000 + i));
    const feed = Object.fromEntries(keys.filter((k) => k !== '1100').map((k) => [k, 'Active']));
    const h = harness(keys, feed, (_url, asked) =>
      asked.includes('1000') ? new Error('timeout') : undefined,
    );
    const report = await h.run();

    // The failed batch holds 1000..1099. The second batch omits 1100, so it comes down.
    expect(h.taken).toEqual([['id-1100']]);
    expect(report).toMatchObject({ errors: PROBE_BATCH_SIZE, takenDown: 1, kept: 1 });
  });

  it('does not take down a key a batch omitted but a single read returns (AC 5)', async () => {
    // The batch answer drops key 2. The single read returns it.
    const h = harness(['1', '2'], { '1': 'Active', '2': 'Active' }, (_url, asked) =>
      asked.length === 2
        ? { records: [{ ListingKey: 1, StandardStatus: 'Active' }], nextLink: null, count: 1 }
        : undefined,
    );
    const report = await h.run();

    expect(h.taken).toEqual([[]]);
    expect(report).toMatchObject({ kept: 2, takenDown: 0 });
  });

  it('leaves a key live when its single confirmation read fails (AC 5)', async () => {
    const h = harness(['1', '2'], { '1': 'Active' }, (_url, asked) =>
      asked.length === 1 ? new Error('HTTP 500') : undefined,
    );
    const report = await h.run();

    expect(h.taken).toEqual([[]]);
    expect(report).toMatchObject({ takenDown: 0, errors: 1 });
  });

  it('leaves a key live when Bright returns it with no status (AC 5)', async () => {
    const h = harness(['1', '2'], { '2': 'Active' }, (_url, asked) =>
      asked.length === 2
        ? {
            records: [{ ListingKey: 1 }, { ListingKey: 2, StandardStatus: 'Active' }],
            nextLink: null,
            count: 2,
          }
        : undefined,
    );
    const report = await h.run();

    expect(h.taken).toEqual([[]]);
    expect(report).toMatchObject({ takenDown: 0, kept: 1, errors: 1 });
  });

  it('never sends a key that is not all digits (AC 5)', async () => {
    const h = harness(['1', "2') or ListingKey eq ('3"], { '1': 'Active' });
    const report = await h.run();

    expect(h.urls).toHaveLength(1);
    expect(decodeURIComponent(h.urls[0] as string)).not.toContain(' or ');
    expect(h.taken).toEqual([[]]);
    expect(report).toMatchObject({ checked: 1, errors: 1, takenDown: 0 });
  });

  it('counts only confirmed keys against the cap (AC 6)', async () => {
    // The batch omits keys 2 and 3. Single reads return both, so nothing is a candidate.
    const h = harness(
      ['1', '2', '3'],
      { '1': 'Active', '2': 'Active', '3': 'Active' },
      (_url, asked) =>
        asked.length === 3
          ? { records: [{ ListingKey: 1, StandardStatus: 'Active' }], nextLink: null, count: 1 }
          : undefined,
      2,
    );
    const report = await h.run();

    expect(report).toMatchObject({ aborted: false, takenDown: 0, kept: 3 });
  });

  it('takes down nothing and logs the abort above the cap (AC 6)', async () => {
    const h = harness(['1', '2', '3'], { '1': 'Active' }, undefined, 1);
    const report = await h.run();

    expect(h.taken).toEqual([]);
    expect(report).toMatchObject({ aborted: true, takenDown: 0, candidates: 2 });
    expect(h.logs.join('\n')).toMatch(/ABORT.*2 listing.*cap of 1/);
  });

  it('takes down exactly the cap when the count equals it (AC 6)', async () => {
    const h = harness(['1', '2', '3'], { '1': 'Active' }, undefined, 2);
    const report = await h.run();

    expect(report).toMatchObject({ aborted: false, takenDown: 2 });
  });

  it('is a no-op on a second run once the first took the keys down (AC 8)', async () => {
    const feed = { '1': 'Active' };
    const first = harness(['1', '2'], feed);
    expect((await first.run()).takenDown).toBe(1);
    // After the first run, the local live set holds only the key Bright returns.
    const second = harness(['1'], feed);
    const report = await second.run();

    expect(second.taken).toEqual([[]]);
    expect(report).toMatchObject({ takenDown: 0, kept: 1 });
  });

  it('probes nothing and takes nothing down for an empty local set (AC 7)', async () => {
    const h = harness([], {});
    const report = await h.run();

    expect(h.urls).toEqual([]);
    expect(report).toMatchObject({ checked: 0, kept: 0, takenDown: 0, errors: 0, aborted: false });
  });

  it('logs the counts of a run (AC 7)', async () => {
    const h = harness(['1', '2'], { '1': 'Active' });
    await h.run();

    expect(h.logs.join('\n')).toMatch(/checked 2, kept 1, taken down 1, errors 0, aborted no/);
  });
});
