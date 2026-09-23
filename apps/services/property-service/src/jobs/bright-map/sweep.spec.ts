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
    // Only the tier-check query ran. Nothing was deleted, and no transaction was opened.
    expect(calls).toHaveLength(1);
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
