import { sweepOtherFeedTiers, ZERO_SWEEP_REPORT } from './sweep';

interface RecordedCall {
  sql: string;
  params: unknown[];
}

interface FakeOptions {
  /** `feed_tier` values the tier-check query should report as present and not current. */
  otherTiers?: string[];
  /** Rows currently `is_sample = true`, before the sweep's DELETE statements run. */
  sampleListingCount?: number;
  stagingRowsDeleted?: number;
  cursorRowsDeleted?: number;
  /** Throws on the given SQL substring, to exercise the rollback path. */
  failOn?: string;
}

interface FakeQueryResult {
  rows: Record<string, unknown>[];
  rowCount?: number | null;
}

function createFakeClient(options: FakeOptions = {}): {
  client: { query: (sql: string, params?: unknown[]) => Promise<FakeQueryResult> };
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const client = {
    async query(sql: string, params: unknown[] = []): Promise<FakeQueryResult> {
      calls.push({ sql, params });
      if (options.failOn !== undefined && sql.includes(options.failOn)) {
        throw new Error(`forced failure: ${options.failOn}`);
      }
      if (sql.includes('UNION')) {
        return { rows: (options.otherTiers ?? []).map((feed_tier) => ({ feed_tier })) };
      }
      if (sql.includes('count(*)::int AS n FROM listings')) {
        return { rows: [{ n: options.sampleListingCount ?? 0 }] };
      }
      if (sql.includes('DELETE FROM bright_staging_records')) {
        return { rows: [], rowCount: options.stagingRowsDeleted ?? 0 };
      }
      if (sql.includes('DELETE FROM bright_replication_cursor')) {
        return { rows: [], rowCount: options.cursorRowsDeleted ?? 0 };
      }
      // Every DELETE issued by db/write.ts's deleteSampleData(), plus BEGIN/COMMIT/ROLLBACK.
      return { rows: [] };
    },
  };
  return { client, calls };
}

describe('sweepOtherFeedTiers (#314)', () => {
  it('is a no-op when every staged row already carries the current tier', async () => {
    const { client, calls } = createFakeClient({ otherTiers: [] });

    const report = await sweepOtherFeedTiers(client, 'production');

    expect(report).toEqual(ZERO_SWEEP_REPORT);
    // Only the tier check and the leftover-sample count ran. Nothing was deleted, no transaction.
    expect(calls.map((call) => call.sql.trim())).not.toContain('BEGIN');
    expect(calls.some((call) => call.sql.includes('DELETE'))).toBe(false);
  });

  it('on production, deletes leftover sample listings even when no other-tier staging rows remain (#375)', async () => {
    const { client, calls } = createFakeClient({ otherTiers: [], sampleListingCount: 5 });

    const report = await sweepOtherFeedTiers(client, 'production');

    expect(report.swept).toBe(true);
    expect(report.sampleListingsDeleted).toBe(5);
    expect(calls.some((call) => /DELETE FROM listings\b/.test(call.sql))).toBe(true);
    expect(calls.some((call) => call.sql.includes('DELETE FROM listing_inquiries'))).toBe(true);
  });

  it('on the test tier, keeps its own sample listings when no other tier is present', async () => {
    const { client, calls } = createFakeClient({ otherTiers: [], sampleListingCount: 5 });

    const report = await sweepOtherFeedTiers(client, 'test');

    expect(report).toEqual(ZERO_SWEEP_REPORT);
    expect(calls.some((call) => call.sql.includes('DELETE'))).toBe(false);
  });

  it('sweeps the other tier out of both staging tables and every sample listing, in one transaction', async () => {
    const { client, calls } = createFakeClient({
      otherTiers: ['test'],
      sampleListingCount: 3,
      stagingRowsDeleted: 40,
      cursorRowsDeleted: 2,
    });

    const report = await sweepOtherFeedTiers(client, 'production');

    expect(report).toEqual({
      swept: true,
      otherTiers: ['test'],
      stagingRowsDeleted: 40,
      cursorRowsDeleted: 2,
      sampleListingsDeleted: 3,
    });

    const sql = calls.map((call) => call.sql);
    const beginAt = sql.findIndex((s) => s.trim() === 'BEGIN');
    const commitAt = sql.findIndex((s) => s.trim() === 'COMMIT');
    const stagingDeleteAt = sql.findIndex((s) => s.includes('DELETE FROM bright_staging_records'));
    const cursorDeleteAt = sql.findIndex((s) =>
      s.includes('DELETE FROM bright_replication_cursor'),
    );
    const listingsDeleteAt = sql.findIndex((s) => /DELETE FROM listings\b/.test(s));

    expect(beginAt).toBeGreaterThanOrEqual(0);
    expect(commitAt).toBeGreaterThan(beginAt);
    expect(stagingDeleteAt).toBeGreaterThan(beginAt);
    expect(stagingDeleteAt).toBeLessThan(commitAt);
    expect(cursorDeleteAt).toBeGreaterThan(beginAt);
    expect(cursorDeleteAt).toBeLessThan(commitAt);
    // db/write.ts's deleteSampleData() ran inside the same transaction.
    expect(listingsDeleteAt).toBeGreaterThan(beginAt);
    expect(listingsDeleteAt).toBeLessThan(commitAt);
  });

  it('scopes both staging deletes to rows that are NOT the current tier', async () => {
    const { client, calls } = createFakeClient({ otherTiers: ['test'] });

    await sweepOtherFeedTiers(client, 'production');

    const staging = calls.find((call) => call.sql.includes('DELETE FROM bright_staging_records'));
    const cursors = calls.find((call) =>
      call.sql.includes('DELETE FROM bright_replication_cursor'),
    );
    expect(staging?.sql).toContain('feed_tier != $1');
    expect(staging?.params).toEqual(['production']);
    expect(cursors?.sql).toContain('feed_tier != $1');
    expect(cursors?.params).toEqual(['production']);
  });

  it('rolls back and rethrows when a delete fails, leaving nothing committed', async () => {
    const { client, calls } = createFakeClient({
      otherTiers: ['test'],
      failOn: 'DELETE FROM bright_staging_records',
    });

    await expect(sweepOtherFeedTiers(client, 'production')).rejects.toThrow(
      'forced failure: DELETE FROM bright_staging_records',
    );

    const sql = calls.map((call) => call.sql.trim());
    expect(sql).toContain('ROLLBACK');
    expect(sql).not.toContain('COMMIT');
  });
});
