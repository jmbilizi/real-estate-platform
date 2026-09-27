import {
  backfillStatuses,
  prepareWorker,
  resolveWorkerSettings,
  soldCloseDateFrom,
  waitForSchema,
  type WorkerPool,
} from './worker';

function fakePool(
  otherTier: string | null,
  sampleCount = 663,
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

    await prepareWorker(pool, 'production', (m) => log.push(m));

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

    await prepareWorker(pool, 'production', () => undefined);

    expect(sql.some((s) => s.startsWith('DELETE FROM listings'))).toBe(true);
  });

  it('deletes nothing when every staged row is already the current tier and no sample rows exist', async () => {
    const { pool, sql } = fakePool(null, 0);

    await prepareWorker(pool, 'production', () => undefined);

    expect(sql.some((s) => s.startsWith('DELETE'))).toBe(false);
  });
});

describe('worker settings', () => {
  it('defaults to a 5 min incremental, 2 min overlap, daily reconcile, 365 day sold lookback', () => {
    expect(resolveWorkerSettings({})).toEqual({
      incrementalIntervalMs: 300_000,
      overlapMs: 120_000,
      reconcileIntervalMs: 86_400_000,
      soldLookbackDays: 365,
      soldDisplayDelayDays: null,
      pollMs: 10_000,
      concurrency: 6,
      pageSize: 5_000,
    });
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

  it('backfills Closed only when the sold display delay is configured', () => {
    expect(backfillStatuses(resolveWorkerSettings({}))).not.toContain('Closed');
    expect(
      backfillStatuses(resolveWorkerSettings({ BRIGHT_SOLD_DISPLAY_DELAY_DAYS: '0' })),
    ).toContain('Closed');
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
