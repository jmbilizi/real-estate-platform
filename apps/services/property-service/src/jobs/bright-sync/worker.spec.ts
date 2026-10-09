import { selectFingerprint } from './select';
import type { BackfillState } from './sync';
import {
  backfillIncomplete,
  backfillStatuses,
  prepareWorker,
  resolveWorkerSettings,
  SELECT_FINGERPRINT_STREAM,
  soldCloseDateFrom,
  waitForSchema,
  type WorkerPool,
} from './worker';

const SETTINGS = resolveWorkerSettings({});

function fakePool(
  otherTier: string | null,
  sampleCount = 663,
  liveListings = true,
): { pool: WorkerPool; sql: string[] } {
  const sql: string[] = [];
  const query = (text: string) => {
    sql.push(text.replace(/\s+/g, ' ').trim());
    if (text.includes('SELECT feed_tier FROM bright_staging_records')) {
      return Promise.resolve({ rows: otherTier === null ? [] : [{ feed_tier: otherTier }] });
    }
    if (text.includes('count(*)::int AS n FROM listings WHERE is_sample')) {
      return Promise.resolve({ rows: [{ n: sampleCount }] });
    }
    if (text.includes('SELECT EXISTS')) {
      return Promise.resolve({ rows: [{ present: liveListings }] });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  };
  return {
    pool: { query, connect: () => Promise.resolve({ query, release: () => undefined }) },
    sql,
  };
}

describe('prepareWorker', () => {
  it('sweeps test-feed listings when the tier switched to production, before any backfill', async () => {
    const { pool, sql } = fakePool('test');
    const log: string[] = [];

    await prepareWorker(pool, 'production', SETTINGS, (m) => log.push(m));

    const failed = sql.findIndex((s) => s.includes("SET status = 'failed'"));
    const sampleDelete = sql.findIndex((s) => s.startsWith('DELETE FROM listings'));
    const stagingDelete = sql.findIndex((s) =>
      s.startsWith('DELETE FROM bright_staging_records WHERE feed_tier != $1'),
    );
    expect(failed).toBe(0);
    expect(sampleDelete).toBeGreaterThan(failed);
    expect(stagingDelete).toBeGreaterThan(sampleDelete);
    expect(sql).toContain('COMMIT');
    expect(sql.some((s) => s.includes('bright_sync_runs') && s.startsWith('INSERT'))).toBe(false);
    expect(log.join('\n')).toContain('663 sample listing(s)');
  });

  it('deletes leftover test-feed listings on production even with no other-tier staging rows (#375)', async () => {
    const { pool, sql } = fakePool(null, 12);

    await prepareWorker(pool, 'production', SETTINGS, () => undefined);

    expect(sql.some((s) => s.startsWith('DELETE FROM listings'))).toBe(true);
  });

  it('deletes nothing when every staged row is already the current tier and no sample rows exist', async () => {
    const { pool, sql } = fakePool(null, 0);

    await prepareWorker(pool, 'production', SETTINGS, () => undefined);

    expect(sql.some((s) => s.startsWith('DELETE'))).toBe(false);
  });
});

/**
 * Backfill checkpoints keyed by `feed:stream`, so `readState`/`writeState`'s real SQL text
 * (matched literally, as the worker calls it) drives one in-memory checkpoint per status.
 */
function checkpointPool(
  liveListings: boolean,
  seed: BackfillState,
): {
  pool: WorkerPool;
  states: Map<string, BackfillState>;
} {
  const states = new Map<string, BackfillState>();
  const query = (text: string, params: unknown[] = []) => {
    const sql = text.replace(/\s+/g, ' ').trim();
    if (sql.startsWith('SELECT EXISTS')) {
      return Promise.resolve({ rows: [{ present: liveListings }] });
    }
    if (sql.startsWith('SELECT state FROM bright_sync_state')) {
      const key = `${String(params[0])}:${String(params[1])}`;
      // A tier whose last backfill plan used today's field list, unless a test says otherwise.
      const fallback =
        params[1] === SELECT_FINGERPRINT_STREAM ? { fingerprint: selectFingerprint() } : seed;
      const state = states.get(key) ?? fallback;
      return Promise.resolve({ rows: [{ state: JSON.stringify(state) }] });
    }
    if (sql.startsWith('INSERT INTO bright_sync_state')) {
      const key = `${String(params[0])}:${String(params[1])}`;
      states.set(key, JSON.parse(String(params[2])) as BackfillState);
      return Promise.resolve({ rows: [] });
    }
    if (sql.includes('SELECT feed_tier FROM bright_staging_records')) {
      return Promise.resolve({ rows: [] });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  };
  return {
    pool: { query, connect: () => Promise.resolve({ query, release: () => undefined }) },
    states,
  };
}

describe('prepareWorker resets an empty tier (2026-09-27 ruling)', () => {
  const statuses = backfillStatuses(SETTINGS);

  it('resets a complete checkpoint to run a full backfill when the tier has no live listings', async () => {
    const { pool } = checkpointPool(false, { through: '2026-01-01', complete: true });

    await prepareWorker(pool, 'production', SETTINGS, () => undefined);

    expect(await backfillIncomplete(pool, 'production', statuses)).toBe(true);
  });

  it('leaves a complete checkpoint alone when the tier has live listings', async () => {
    const { pool } = checkpointPool(true, { through: '2026-01-01', complete: true });

    await prepareWorker(pool, 'production', SETTINGS, () => undefined);

    expect(await backfillIncomplete(pool, 'production', statuses)).toBe(false);
  });

  it('leaves an incomplete checkpoint to resume, unchanged', async () => {
    const { pool } = checkpointPool(true, { through: '2026-01-01', complete: false });

    await prepareWorker(pool, 'production', SETTINGS, () => undefined);

    expect(await backfillIncomplete(pool, 'production', statuses)).toBe(true);
  });
});

describe('prepareWorker backfills again when the field list changes (#722)', () => {
  const statuses = backfillStatuses(SETTINGS);
  const complete: BackfillState = { through: '2026-01-01', complete: true };
  const fingerprintKey = `production:${SELECT_FINGERPRINT_STREAM}`;

  it('resets a complete backfill when the stored fingerprint differs', async () => {
    const { pool, states } = checkpointPool(true, complete);
    states.set(fingerprintKey, { fingerprint: 'old' } as unknown as BackfillState);
    const log: string[] = [];

    await prepareWorker(pool, 'production', SETTINGS, (m) => log.push(m));

    expect(await backfillIncomplete(pool, 'production', statuses)).toBe(true);
    expect(states.get(fingerprintKey)).toEqual({ fingerprint: selectFingerprint() });
    expect(log.join(' ')).toContain('field list changed');
  });

  it('plans a backfill for a tier that never stored a fingerprint', async () => {
    const { pool, states } = checkpointPool(true, complete);
    states.set(fingerprintKey, {} as unknown as BackfillState);

    await prepareWorker(pool, 'production', SETTINGS, () => undefined);

    expect(await backfillIncomplete(pool, 'production', statuses)).toBe(true);
  });

  it('is idempotent: a second start keeps a resumed backfill and writes nothing', async () => {
    const { pool, states } = checkpointPool(true, complete);
    states.set(fingerprintKey, { fingerprint: 'old' } as unknown as BackfillState);
    await prepareWorker(pool, 'production', SETTINGS, () => undefined);
    const progress: BackfillState = { through: '2026-05-01', complete: false };
    for (const status of statuses) states.set(`production:backfill:${status}`, progress);

    await prepareWorker(pool, 'production', SETTINGS, () => undefined);

    expect(states.get(`production:backfill:${statuses[0]}`)).toEqual(progress);
  });
});

describe('selectFingerprint', () => {
  it('ignores field order and changes when a field is added', () => {
    expect(selectFingerprint(['A', 'B'])).toBe(selectFingerprint(['B', 'A']));
    expect(selectFingerprint(['A', 'B'])).not.toBe(selectFingerprint(['A', 'B', 'C']));
    expect(selectFingerprint()).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('worker settings', () => {
  it('defaults to a 5 min incremental, 2 min overlap, daily reconcile, 365 day sold lookback', () => {
    expect(resolveWorkerSettings({})).toEqual({
      incrementalIntervalMs: 300_000,
      overlapMs: 120_000,
      reconcileIntervalMs: 86_400_000,
      probeIntervalMs: 86_400_000,
      probeMaxTakedown: 500,
      soldLookbackDays: 365,
      soldDisplayDelayDays: null,
      pollMs: 10_000,
      concurrency: 6,
      pageSize: 5_000,
      applyConcurrency: 4,
      applyChunkSize: 250,
      applyPaceRatio: 1,
    });
  });

  it('reads the write chunk size and pace ratio, and accepts a ratio of 0 (#755)', () => {
    expect(
      resolveWorkerSettings({
        BRIGHT_SYNC_APPLY_CHUNK_SIZE: '100',
        BRIGHT_SYNC_APPLY_PACE_RATIO: '0',
      }),
    ).toMatchObject({ applyChunkSize: 100, applyPaceRatio: 0 });
    expect(() => resolveWorkerSettings({ BRIGHT_SYNC_APPLY_CHUNK_SIZE: '0' })).toThrow(
      /BRIGHT_SYNC_APPLY_CHUNK_SIZE/,
    );
  });

  it('reads the sync concurrency and page size, and refuses a page size over 10,000', () => {
    expect(
      resolveWorkerSettings({ BRIGHT_SYNC_CONCURRENCY: '3', BRIGHT_SYNC_PAGE_SIZE: '10000' }),
    ).toEqual(expect.objectContaining({ concurrency: 3, pageSize: 10_000 }));
    expect(() => resolveWorkerSettings({ BRIGHT_SYNC_PAGE_SIZE: '10001' })).toThrow(
      'BRIGHT_SYNC_PAGE_SIZE must be 10000 or less',
    );
    expect(() => resolveWorkerSettings({ BRIGHT_SYNC_CONCURRENCY: '0' })).toThrow(
      'BRIGHT_SYNC_CONCURRENCY must be a positive integer',
    );
  });

  it('reads the apply concurrency (#359)', () => {
    expect(resolveWorkerSettings({ BRIGHT_SYNC_APPLY_CONCURRENCY: '8' })).toEqual(
      expect.objectContaining({ applyConcurrency: 8 }),
    );
    expect(() => resolveWorkerSettings({ BRIGHT_SYNC_APPLY_CONCURRENCY: '0' })).toThrow(
      'BRIGHT_SYNC_APPLY_CONCURRENCY must be a positive integer',
    );
  });

  it('backfills Closed only when the sold display delay is configured', () => {
    expect(backfillStatuses(resolveWorkerSettings({}))).not.toContain('Closed');
    expect(
      backfillStatuses(resolveWorkerSettings({ BRIGHT_SOLD_DISPLAY_DELAY_DAYS: '0' })),
    ).toContain('Closed');
  });

  it('reads the sold display delay as 0, 30 or unset (#228)', () => {
    const delay = (value?: string) =>
      resolveWorkerSettings(value === undefined ? {} : { BRIGHT_SOLD_DISPLAY_DELAY_DAYS: value })
        .soldDisplayDelayDays;
    expect(delay('0')).toBe(0);
    expect(delay('30')).toBe(30);
    expect(delay()).toBeNull();
    expect(delay('')).toBeNull();
  });

  it('computes the CloseDate lower bound from the lookback', () => {
    expect(soldCloseDateFrom(new Date('2026-09-26T12:00:00Z'), 365)).toBe('2025-09-26');
  });

  it('refuses a malformed interval', () => {
    expect(() => resolveWorkerSettings({ BRIGHT_SYNC_POLL_MS: 'soon' })).toThrow(
      'BRIGHT_SYNC_POLL_MS',
    );
  });
});

describe('waitForSchema', () => {
  it('retries a refused connection and a missing table, then returns', async () => {
    const answers = [
      () => Promise.reject(new Error('connect ECONNREFUSED')),
      () => Promise.resolve({ rows: [{ ready: false }] }),
      () => Promise.resolve({ rows: [{ ready: true }] }),
    ];
    let call = 0;
    const log: string[] = [];
    await waitForSchema(
      { query: () => (answers[call++] as () => Promise<{ rows: Record<string, unknown>[] }>)() },
      (m) => log.push(m),
      { delayMs: 0 },
    );
    expect(call).toBe(3);
    expect(log[0]).toContain('ECONNREFUSED');
  });

  it('gives up after the attempt limit', async () => {
    await expect(
      waitForSchema(
        { query: () => Promise.resolve({ rows: [{ ready: false }] }) },
        () => undefined,
        {
          attempts: 2,
          delayMs: 0,
        },
      ),
    ).rejects.toThrow('not ready after 2 attempts');
  });
});
