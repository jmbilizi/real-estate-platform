import type { BrightPage } from '../bright-ingest/bright-client';
import { BRIGHT_STATUS_FILTER_LABELS } from '../bright-map/status';
import {
  backfillStream,
  type Checkpoint,
  INCREMENTAL_STREAM,
  PAGE_SIZE,
  type PageResult,
  runAudit,
  runBackfill,
  runIncremental,
  runReconcile,
  type SyncDeps,
} from './sync';

const ROOT = 'https://bright-reso.brightmls.com/RESO/OData/bright';

interface Rec {
  ListingKey: number;
  StandardStatus: string;
  ModificationTimestamp: string;
  City?: string;
  CloseDate?: string;
}

/**
 * An in-memory Bright that behaves like the live feed on 2026-09-26: `$filter` takes the spaced
 * status LABEL while records carry the compact payload value, `$count=true` is exact, and
 * `$orderby=ListingKey` is IGNORED — every page comes back shuffled.
 */
function fakeBright(all: Rec[]) {
  const urls: string[] = [];
  let seed = 7;
  const shuffle = <T>(items: T[]): T[] => {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      const j = seed % (i + 1);
      [out[i], out[j]] = [out[j] as T, out[i] as T];
    }
    return out;
  };
  const fetchPage = (url: string): Promise<BrightPage> => {
    urls.push(url);
    const q = new URL(url).searchParams;
    const filter = q.get('$filter') ?? '';
    const top = Number(q.get('$top') ?? PAGE_SIZE);
    let rows = all.slice();
    const status = /StandardStatus eq '([^']+)'/.exec(filter)?.[1];
    if (status !== undefined) {
      rows = rows.filter((r) => BRIGHT_STATUS_FILTER_LABELS[r.StandardStatus] === status);
    }
    const city = /City eq '([^']+)'/.exec(filter)?.[1];
    if (city !== undefined) rows = rows.filter((r) => r.City?.toLowerCase() === city.toLowerCase());
    const closeFrom = /CloseDate ge (\S+)/.exec(filter)?.[1];
    if (closeFrom !== undefined) rows = rows.filter((r) => (r.CloseDate ?? '') >= closeFrom);
    const ts = (r: Rec) => Date.parse(r.ModificationTimestamp);
    const gt = /ModificationTimestamp gt (\S+)/.exec(filter)?.[1];
    if (gt !== undefined) rows = rows.filter((r) => ts(r) > Date.parse(gt));
    const le = /ModificationTimestamp le (\S+)/.exec(filter)?.[1];
    if (le !== undefined) rows = rows.filter((r) => ts(r) <= Date.parse(le));
    const keyGt = /ListingKey gt (\d+)/.exec(filter)?.[1];
    if (keyGt !== undefined) rows = rows.filter((r) => r.ListingKey > Number(keyGt));
    const keyLe = /ListingKey le (\d+)/.exec(filter)?.[1];
    if (keyLe !== undefined) rows = rows.filter((r) => r.ListingKey <= Number(keyLe));
    const keyEq = /ListingKey eq (\d+)/.exec(filter)?.[1];
    if (keyEq !== undefined) rows = rows.filter((r) => r.ListingKey === Number(keyEq));
    if (q.get('$count') === 'true') {
      return Promise.resolve({ records: [], nextLink: null, count: rows.length });
    }
    return Promise.resolve({
      records: shuffle(rows).slice(0, top) as unknown as Record<string, unknown>[],
      nextLink: null,
    });
  };
  return { fetchPage, urls };
}

const RESULT: PageResult = {
  staged: 0,
  mapped: 0,
  published: 0,
  withheld: 0,
  takenDown: 0,
  withheldByReason: {},
};

const NOW = '2026-09-26T12:00:00.000Z';

function harness(all: Rec[], options: { failOnApply?: number } = {}) {
  const bright = fakeBright(all);
  const state = new Map<string, unknown>();
  const applied: string[] = [];
  let applyCalls = 0;
  const deps: SyncDeps = {
    serviceRoot: ROOT,
    fetchPage: bright.fetchPage,
    applyPage: (page, checkpoint: Checkpoint | null) => {
      applyCalls += 1;
      if (options.failOnApply === applyCalls) {
        return Promise.reject(new Error('pod killed'));
      }
      applied.push(...page.map((r) => String(r.ListingKey)));
      if (checkpoint !== null) state.set(checkpoint.stream, checkpoint.state);
      return Promise.resolve({ ...RESULT, staged: page.length, mapped: page.length });
    },
    readState: <T>(stream: string) => Promise.resolve((state.get(stream) as T) ?? null),
    writeState: (stream, value) => {
      state.set(stream, value);
      return Promise.resolve();
    },
    progress: () => Promise.resolve(),
    now: () => new Date(NOW),
    log: () => undefined,
  };
  return { deps, state, applied, urls: bright.urls };
}

/** `count` records of one status, one per minute, ending an hour before `NOW`. */
function records(count: number, status = 'Active', firstKey = 1000): Rec[] {
  const end = Date.parse(NOW) - 3_600_000;
  return Array.from({ length: count }, (_, i) => ({
    ListingKey: firstKey + i,
    StandardStatus: status,
    ModificationTimestamp: new Date(end - (count - i) * 60_000).toISOString(),
  }));
}

const keysOf = (rows: Rec[]) => rows.map((r) => String(r.ListingKey)).sort();
const filters = (urls: string[]) => urls.map((u) => new URL(u).searchParams.get('$filter') ?? '');
const BACKFILL = { resume: false, soldCloseDateFrom: '2025-09-26' };

describe('runBackfill', () => {
  it('reads every record of each status although Bright returns pages unordered', async () => {
    const all = [...records(2500), ...records(3, 'ComingSoon', 9000)];
    const h = harness(all);

    await runBackfill(h.deps, { ...BACKFILL, statuses: ['Active', 'ComingSoon'] });

    expect(h.applied.sort()).toEqual(keysOf(all));
    expect(h.state.get(backfillStream('Active'))).toEqual({ through: NOW, complete: true });
    expect(filters(h.urls).some((f) => f.includes("StandardStatus eq 'Coming Soon'"))).toBe(true);
    expect(filters(h.urls).every((f) => !f.includes("'ComingSoon'"))).toBe(true);
    const read = h.urls.find((u) => new URL(u).searchParams.get('$count') === null) as string;
    expect(new URL(read).searchParams.get('$select')).toContain('City');
  });

  it('resumes after its checkpoint after a crash, and ends with every record written', async () => {
    const all = records(3500);
    const h = harness(all, { failOnApply: 3 });

    await expect(runBackfill(h.deps, { ...BACKFILL, statuses: ['Active'] })).rejects.toThrow(
      'pod killed',
    );
    const checkpoint = h.state.get(backfillStream('Active')) as { through: string };
    expect(checkpoint.through).not.toBeNull();

    const resumed = harness(all);
    for (const [key, value] of h.state) resumed.state.set(key, value);
    await runBackfill(resumed.deps, { ...BACKFILL, statuses: ['Active'], resume: true });

    expect(filters(resumed.urls)[0]).toContain(`ModificationTimestamp gt ${checkpoint.through}`);
    expect(new Set([...h.applied, ...resumed.applied])).toEqual(new Set(keysOf(all)));
    const firstRead = new Set(h.applied);
    expect(resumed.applied.filter((k) => firstRead.has(k))).toEqual([]);
  });

  it('skips a complete stream on resume and restarts it otherwise', async () => {
    const h = harness(records(10));
    h.state.set(backfillStream('Active'), { through: NOW, complete: true });

    await runBackfill(h.deps, { ...BACKFILL, statuses: ['Active'], resume: true });
    expect(h.urls).toHaveLength(0);

    await runBackfill(h.deps, { ...BACKFILL, statuses: ['Active'] });
    expect(h.applied).toHaveLength(10);
  });

  it('splits one instant wider than a page by ListingKey range', async () => {
    const at = '2026-09-20T00:00:00.000Z';
    const block = Array.from({ length: PAGE_SIZE + 250 }, (_, i) => ({
      ListingKey: 805_000_000_000 + i * 7,
      StandardStatus: 'Active',
      ModificationTimestamp: at,
    }));
    const h = harness(block);

    await runBackfill(h.deps, { ...BACKFILL, statuses: ['Active'] });

    expect(h.applied.sort()).toEqual(keysOf(block));
    expect(filters(h.urls).some((f) => f.includes('ListingKey le'))).toBe(true);
  });

  it('splits a slice that grew past one page between its count and its read', async () => {
    const all = records(1000);
    const h = harness(all);
    let first = true;
    const grew = {
      ...h.deps,
      fetchPage: async (url: string) => {
        const page = await h.deps.fetchPage(url);
        if (first && page.count !== undefined) {
          first = false;
          return { ...page, count: 999 };
        }
        return page;
      },
    };

    await runBackfill(grew, { ...BACKFILL, statuses: ['Active'] });

    expect(new Set(h.applied)).toEqual(new Set(keysOf(all)));
  });

  it('bounds the Closed pass by CloseDate', async () => {
    const all: Rec[] = [
      {
        ListingKey: 1,
        StandardStatus: 'Closed',
        ModificationTimestamp: '2026-01-01T00:00:00Z',
        CloseDate: '2026-03-01',
      },
      {
        ListingKey: 2,
        StandardStatus: 'Closed',
        ModificationTimestamp: '2020-01-01T00:00:00Z',
        CloseDate: '2019-03-01',
      },
    ];
    const h = harness(all);

    await runBackfill(h.deps, { ...BACKFILL, statuses: ['Closed'] });

    expect(h.applied).toEqual(['1']);
    expect(filters(h.urls)[0]).toContain('CloseDate ge 2025-09-26');
  });

  it('sizes a slice request to deps.pageSize instead of the 1,000 default (#348)', async () => {
    const all = records(1500);
    const h = harness(all);
    const sized = { ...h.deps, pageSize: 2_000 };

    await runBackfill(sized, { ...BACKFILL, statuses: ['Active'] });

    expect(h.applied.sort()).toEqual(keysOf(all));
    const read = h.urls.find((u) => new URL(u).searchParams.get('$count') === null) as string;
    expect(new URL(read).searchParams.get('$top')).toBe('2000');
  });

  it('bounds slices with fetched data in flight to deps.concurrency (#348)', async () => {
    // Several slices at the default PAGE_SIZE, so the recursion fans out to more than 2 leaves.
    const all = records(4000);
    const h = harness(all);
    let unblockFirstApply: (() => void) | undefined;
    let applyCalls = 0;
    const gated: SyncDeps = {
      ...h.deps,
      concurrency: 2,
      applyPage: (page, checkpoint) => {
        applyCalls += 1;
        if (applyCalls === 1) {
          return new Promise((resolve) => {
            unblockFirstApply = () => resolve(h.deps.applyPage(page, checkpoint));
          });
        }
        return h.deps.applyPage(page, checkpoint);
      },
    };

    const run = runBackfill(gated, { ...BACKFILL, statuses: ['Active'] });
    // Let every slice that CAN proceed without blocking do so (no real timers are involved, so
    // draining pending microtasks a few times over is enough — and far short of the 5s test
    // timeout — for everything but the deliberately-blocked first apply to settle).
    for (let i = 0; i < 10; i += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    const dataFetches = h.urls.filter((u) => new URL(u).searchParams.get('$count') !== 'true');
    expect(dataFetches.length).toBeLessThanOrEqual(2);
    expect(h.applied).toHaveLength(0);

    unblockFirstApply?.();
    await run;

    expect(h.applied.sort()).toEqual(keysOf(all));
  });

  it('keeps no checkpoint for an area pass', async () => {
    const all = records(3).map((r, i) => (i === 0 ? { ...r, City: 'FREDERICK' } : r));
    const h = harness(all);

    await runBackfill(h.deps, { ...BACKFILL, statuses: ['Active'], area: { city: 'Frederick' } });

    expect(h.applied).toEqual(['1000']);
    expect(h.state.size).toBe(0);
  });
});

describe('runIncremental', () => {
  it('reads the bounded window with the overlap and moves the watermark after it commits', async () => {
    const all: Rec[] = [
      { ListingKey: 1, StandardStatus: 'Active', ModificationTimestamp: '2026-09-26T11:57:31Z' },
      { ListingKey: 2, StandardStatus: 'Closed', ModificationTimestamp: '2026-09-26T11:59:00Z' },
      { ListingKey: 3, StandardStatus: 'Active', ModificationTimestamp: '2026-09-26T11:50:00Z' },
    ];
    const h = harness(all);
    h.state.set(INCREMENTAL_STREAM, { watermark: '2026-09-26T11:59:30Z' });

    await runIncremental(h.deps, { overlapMs: 120_000 });

    expect(h.applied.sort()).toEqual(['1', '2']);
    expect(h.state.get(INCREMENTAL_STREAM)).toEqual({ watermark: NOW });
    const read = new URL(h.urls[1] as string).searchParams;
    expect(read.get('$filter')).toBe(
      'ModificationTimestamp gt 2026-09-26T11:57:30.000Z and ' +
        'ModificationTimestamp le 2026-09-26T12:00:00.000Z',
    );
    expect(read.get('$orderby')).toBe('ModificationTimestamp asc,ListingKey asc');
  });

  it('does not move the watermark when a page fails', async () => {
    const h = harness(
      records(3).map((r) => ({ ...r, ModificationTimestamp: '2026-09-26T11:59:00Z' })),
      { failOnApply: 1 },
    );
    h.state.set(INCREMENTAL_STREAM, { watermark: '2026-09-26T11:58:00Z' });

    await expect(runIncremental(h.deps, { overlapMs: 120_000 })).rejects.toThrow('pod killed');
    expect(h.state.get(INCREMENTAL_STREAM)).toEqual({ watermark: '2026-09-26T11:58:00Z' });
  });

  it('refuses to run before a backfill recorded a watermark', async () => {
    await expect(runIncremental(harness([]).deps, { overlapMs: 0 })).rejects.toThrow(
      'Run a backfill first',
    );
  });
});

describe('runReconcile', () => {
  function reconcileHarness(all: Rec[], local: Map<string, string>) {
    const h = harness(all);
    const takenDown: string[] = [];
    const deps = {
      ...h.deps,
      listLiveLocal: () => Promise.resolve(local),
      takeDown: (ids: readonly string[]) => {
        takenDown.push(...ids);
        return Promise.resolve(ids.length);
      },
    };
    return { deps, takenDown, urls: h.urls };
  }

  function localOf(count: number, firstKey = 1000): Map<string, string> {
    return new Map(
      Array.from(
        { length: count },
        (_, i) => [String(firstKey + i), `id-${i}`] as [string, string],
      ),
    );
  }

  it('takes down local live listings absent from every Bright status', async () => {
    const local = localOf(10);
    local.set('77', 'id-gone');
    const r = reconcileHarness(records(10), local);

    const result = await runReconcile(r.deps, { statuses: ['Active'] });

    expect(r.takenDown).toEqual(['id-gone']);
    expect(result.takenDown).toBe(1);
    const read = r.urls.find((u) => new URL(u).searchParams.get('$select') === 'ListingKey');
    expect(read).toBeDefined();
  });

  it('keeps an absent key that Bright still lists when read by itself', async () => {
    const moved: Rec = {
      ListingKey: 42,
      StandardStatus: 'Active',
      ModificationTimestamp: '2026-09-26T12:30:00Z',
    };
    const local = localOf(200);
    local.set('42', 'id-moved');
    const r = reconcileHarness([...records(200), moved], local);

    const result = await runReconcile(r.deps, { statuses: ['Active'] });

    expect(r.takenDown).toEqual([]);
    expect(result.keptLive).toBe(1);
  });

  it('refuses when it would take down an outsized share', async () => {
    const r = reconcileHarness(records(10), localOf(10, 5000));

    await expect(runReconcile(r.deps, { statuses: ['Active'] })).rejects.toThrow(
      'Nothing was taken down',
    );
    expect(r.takenDown).toEqual([]);
  });

  it('refuses on a short key read', async () => {
    const r = reconcileHarness(records(10), new Map());
    const shortRead = {
      ...r.deps,
      fetchPage: async (url: string) => {
        const page = await r.deps.fetchPage(url);
        return page.count === undefined ? { ...page, records: page.records.slice(0, 5) } : page;
      },
    };
    await expect(runReconcile(shortRead, { statuses: ['Active'] })).rejects.toThrow(
      'Reconcile read 5 Active keys but Bright counts 10',
    );
  });
});

describe('runAudit', () => {
  it('stores Bright $count against the local count per area and status', async () => {
    const h = harness([...records(4), ...records(2, 'Pending', 50)]);
    const deps = {
      ...h.deps,
      countLocal: (_area: unknown, status: string) => Promise.resolve(status === 'Active' ? 3 : 2),
    };

    const { rows } = await runAudit(deps, {
      areas: [{ label: 'Whole feed' }],
      statuses: ['Active', 'Pending'],
    });

    expect(rows).toEqual([
      { area: 'Whole feed', status: 'Active', bright: 4, local: 3, gapPct: 25 },
      { area: 'Whole feed', status: 'Pending', bright: 2, local: 2, gapPct: 0 },
    ]);
    expect(new URL(h.urls[0] as string).searchParams.get('$count')).toBe('true');
  });
});
