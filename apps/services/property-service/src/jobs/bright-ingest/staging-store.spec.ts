import {
  CHUNK_SIZE,
  createStagingStoreOver,
  StagedRecord,
  StagingConnectable,
  StagingQueryable,
} from './staging-store';

interface RecordedCall {
  sql: string;
  params: unknown[];
}

interface FakeOptions {
  /** Rows returned by the next SELECT. */
  selectRows?: Record<string, unknown>[];
  /** Makes every INSERT into the staging table reject. */
  failInsert?: boolean;
}

function createFakePool(options: FakeOptions = {}): {
  pool: StagingConnectable;
  calls: RecordedCall[];
  released: () => number;
} {
  const calls: RecordedCall[] = [];
  let releases = 0;

  const client: StagingQueryable = {
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      if (options.failInsert && /INSERT INTO bright_staging_records/.test(sql)) {
        throw new Error('insert rejected');
      }
      if (/^\s*SELECT/i.test(sql)) {
        const rows = options.selectRows ?? [];
        return { rows, rowCount: rows.length };
      }
      return { rows: [], rowCount: countPlaceholderRows(sql) };
    },
    release() {
      releases += 1;
    },
  };

  return {
    pool: { connect: async () => client },
    calls,
    released: () => releases,
  };
}

/** Number of `(...)` tuples in a multi-row VALUES list, so the fake reports a plausible rowCount. */
function countPlaceholderRows(sql: string): number {
  return (sql.match(/\(\$\d+/g) ?? []).length;
}

function sqlOf(calls: RecordedCall[]): string[] {
  return calls.map((call) => call.sql.trim().split(/\s+/).slice(0, 4).join(' '));
}

function stagedRecords(count: number, offset = 0): StagedRecord[] {
  return Array.from({ length: count }, (unused, index) => ({
    recordKey: `key-${offset + index}`,
    modifiedAt: '2026-09-18T12:00:00.000Z',
    payload: { ListingKey: `key-${offset + index}` },
  }));
}

const CURSOR = { modifiedAt: '2026-09-18T12:00:00.000Z', recordKey: 'key-9' };
const RUN_ID = '11111111-2222-3333-4444-555555555555';
const TIER = 'test';

describe('BrightStagingStore — commitBatch', () => {
  it('wraps the batch in BEGIN and COMMIT', async () => {
    const { pool, calls } = createFakePool();

    await createStagingStoreOver(pool).commitBatch({
      resource: 'BrightProperties',
      feedTier: TIER,
      runId: RUN_ID,
      records: stagedRecords(2),
      cursor: CURSOR,
    });

    expect(sqlOf(calls)[0]).toBe('BEGIN');
    expect(sqlOf(calls).at(-1)).toBe('COMMIT');
  });

  it('rolls back and rethrows when the insert rejects', async () => {
    const { pool, calls } = createFakePool({ failInsert: true });

    await expect(
      createStagingStoreOver(pool).commitBatch({
        resource: 'BrightProperties',
        feedTier: TIER,
        runId: RUN_ID,
        records: stagedRecords(1),
        cursor: CURSOR,
      }),
    ).rejects.toThrow('insert rejected');

    expect(sqlOf(calls)).toContain('ROLLBACK');
    expect(sqlOf(calls)).not.toContain('COMMIT');
  });

  it('advances the cursor inside the same transaction as the rows', async () => {
    const { pool, calls } = createFakePool();

    await createStagingStoreOver(pool).commitBatch({
      resource: 'BrightProperties',
      feedTier: TIER,
      runId: RUN_ID,
      records: stagedRecords(3),
      cursor: CURSOR,
    });

    const statements = calls.map((call) => call.sql);
    const beginAt = statements.findIndex((sql) => sql.trim() === 'BEGIN');
    const commitAt = statements.findIndex((sql) => sql.trim() === 'COMMIT');
    const cursorAt = statements.findIndex((sql) =>
      sql.includes('INSERT INTO bright_replication_cursor'),
    );
    const insertAt = statements.findIndex((sql) =>
      sql.includes('INSERT INTO bright_staging_records'),
    );

    expect(beginAt).toBeLessThan(insertAt);
    expect(insertAt).toBeLessThan(cursorAt);
    expect(cursorAt).toBeLessThan(commitAt);
  });

  it('advances the cursor for an empty batch, still in a transaction', async () => {
    const { pool, calls } = createFakePool();

    const written = await createStagingStoreOver(pool).commitBatch({
      resource: 'BrightMedia',
      feedTier: TIER,
      runId: RUN_ID,
      records: [],
      cursor: CURSOR,
    });

    expect(written).toBe(0);
    expect(sqlOf(calls)[0]).toBe('BEGIN');
    expect(sqlOf(calls).at(-1)).toBe('COMMIT');
    expect(calls.some((call) => call.sql.includes('INSERT INTO bright_staging_records'))).toBe(
      false,
    );
    expect(calls.some((call) => call.sql.includes('INSERT INTO bright_replication_cursor'))).toBe(
      true,
    );
  });

  /**
   * The regression guard for the `now()` rule in the project guide: a literal inside a VALUES list
   * consumes no placeholder and shifts every later column off its bound value.
   */
  it('binds exactly as many parameters as the multi-row INSERT declares placeholders', async () => {
    const { pool, calls } = createFakePool();

    await createStagingStoreOver(pool).commitBatch({
      resource: 'BrightProperties',
      feedTier: TIER,
      runId: RUN_ID,
      records: stagedRecords(4),
      cursor: CURSOR,
    });

    for (const call of calls.filter((entry) => entry.sql.includes('INSERT INTO'))) {
      const placeholders = new Set(call.sql.match(/\$\d+/g) ?? []);
      expect(placeholders.size).toBe(call.params.length);
      const highest = Math.max(
        ...[...placeholders].map((placeholder) => Number(placeholder.slice(1))),
      );
      expect(highest).toBe(call.params.length);
    }
  });

  it('serialises the payload as JSON text for the jsonb column', async () => {
    const { pool, calls } = createFakePool();

    await createStagingStoreOver(pool).commitBatch({
      resource: 'BrightProperties',
      feedTier: TIER,
      runId: RUN_ID,
      records: [{ recordKey: 'k1', modifiedAt: '2026-09-18T12:00:00.000Z', payload: { a: 1 } }],
      cursor: CURSOR,
    });

    const insert = calls.find((call) => call.sql.includes('INSERT INTO bright_staging_records'));
    expect(insert?.params).toContain('{"a":1}');
  });

  it('splits a large batch into several INSERTs inside one BEGIN/COMMIT pair', async () => {
    const { pool, calls } = createFakePool();

    await createStagingStoreOver(pool).commitBatch({
      resource: 'BrightProperties',
      feedTier: TIER,
      runId: RUN_ID,
      records: stagedRecords(2500),
      cursor: CURSOR,
    });

    const inserts = calls.filter((call) => call.sql.includes('INSERT INTO bright_staging_records'));
    // Derived from the chunk size rather than hardcoded: the constant is tuned against payload
    // size (BrightProperty has 931 fields), and a literal here goes stale every time it moves.
    expect(inserts.length).toBe(Math.ceil(2500 / CHUNK_SIZE));
    expect(inserts.length).toBeGreaterThan(1);
    expect(sqlOf(calls).filter((sql) => sql === 'BEGIN')).toHaveLength(1);
    expect(sqlOf(calls).filter((sql) => sql === 'COMMIT')).toHaveLength(1);
    for (const insert of inserts) {
      expect(insert.params.length).toBeLessThanOrEqual(30000);
    }
  });

  it('accumulates records_staged rather than replacing it', async () => {
    const { pool, calls } = createFakePool();

    await createStagingStoreOver(pool).commitBatch({
      resource: 'BrightProperties',
      feedTier: TIER,
      runId: RUN_ID,
      records: stagedRecords(2),
      cursor: CURSOR,
    });

    const cursorCall = calls.find((call) =>
      call.sql.includes('INSERT INTO bright_replication_cursor'),
    );
    expect(cursorCall?.sql).toContain(
      'records_staged = bright_replication_cursor.records_staged +',
    );
  });

  it('keeps first_seen_at out of the conflict update', async () => {
    const { pool, calls } = createFakePool();

    await createStagingStoreOver(pool).commitBatch({
      resource: 'BrightProperties',
      feedTier: TIER,
      runId: RUN_ID,
      records: stagedRecords(1),
      cursor: CURSOR,
    });

    const insert = calls.find((call) => call.sql.includes('INSERT INTO bright_staging_records'));
    const conflictClause = insert?.sql.slice(insert.sql.indexOf('ON CONFLICT')) ?? '';
    expect(conflictClause).not.toContain('first_seen_at');
    expect(conflictClause).toContain('fetched_at');
  });

  it('releases the client on success and on failure', async () => {
    const good = createFakePool();
    await createStagingStoreOver(good.pool).commitBatch({
      resource: 'BrightProperties',
      feedTier: TIER,
      runId: RUN_ID,
      records: stagedRecords(1),
      cursor: CURSOR,
    });
    expect(good.released()).toBe(1);

    const bad = createFakePool({ failInsert: true });
    await expect(
      createStagingStoreOver(bad.pool).commitBatch({
        resource: 'BrightProperties',
        feedTier: TIER,
        runId: RUN_ID,
        records: stagedRecords(1),
        cursor: CURSOR,
      }),
    ).rejects.toThrow();
    expect(bad.released()).toBe(1);
  });
});

describe('BrightStagingStore — readCursor', () => {
  it('returns nulls when the resource has never replicated', async () => {
    const { pool } = createFakePool({ selectRows: [] });

    await expect(
      createStagingStoreOver(pool).readCursor('BrightProperties', TIER),
    ).resolves.toEqual({
      modifiedAt: null,
      recordKey: null,
    });
  });

  /**
   * A cursor value that will not parse degrades to "never replicated" rather than throwing a bare
   * RangeError out of a cursor read. The next pass then starts from the configured epoch, and the
   * staging upsert absorbs the re-read.
   */
  it('degrades an unparseable cursor instant to null instead of throwing', async () => {
    const { pool } = createFakePool({
      selectRows: [{ cursor_modified_at: 'not a date', cursor_record_key: '42' }],
    });

    await expect(
      createStagingStoreOver(pool).readCursor('BrightProperties', TIER),
    ).resolves.toEqual({
      modifiedAt: null,
      recordKey: '42',
    });
  });

  it('returns the stored watermark as a Z-suffixed instant', async () => {
    const { pool } = createFakePool({
      selectRows: [
        {
          cursor_modified_at: new Date('2026-09-18T12:00:00.000Z'),
          cursor_record_key: 'key-9',
        },
      ],
    });

    await expect(
      createStagingStoreOver(pool).readCursor('BrightProperties', TIER),
    ).resolves.toEqual({
      modifiedAt: '2026-09-18T12:00:00.000Z',
      recordKey: 'key-9',
    });
  });
});

describe('BrightStagingStore — resetCursor', () => {
  it('nulls both cursor columns and deletes no staged rows', async () => {
    const { pool, calls } = createFakePool();

    await createStagingStoreOver(pool).resetCursor('BrightProperties', RUN_ID, TIER);

    const cursorCall = calls.find((call) =>
      call.sql.includes('INSERT INTO bright_replication_cursor'),
    );
    expect(cursorCall?.sql).toContain('cursor_modified_at = NULL');
    expect(cursorCall?.sql).toContain('cursor_record_key = NULL');
    expect(cursorCall?.params).toContain(null);
    expect(cursorCall?.params).toContain(TIER);
    expect(calls.some((call) => /DELETE|TRUNCATE/i.test(call.sql))).toBe(false);
  });

  it('resets only the given tier, never the other one (#314)', async () => {
    const { pool, calls } = createFakePool();

    await createStagingStoreOver(pool).resetCursor('BrightProperties', RUN_ID, 'production');

    const cursorCall = calls.find((call) =>
      call.sql.includes('INSERT INTO bright_replication_cursor'),
    );
    expect(cursorCall?.sql).toContain('ON CONFLICT (feed_tier, resource)');
    expect(cursorCall?.params).toContain('production');
    expect(cursorCall?.params).not.toContain('test');
  });
});

describe('BrightStagingStore — countStaged', () => {
  it('reads the row count for one resource', async () => {
    const { pool, calls } = createFakePool({ selectRows: [{ staged: '42' }] });

    await expect(createStagingStoreOver(pool).countStaged('BrightProperties', TIER)).resolves.toBe(
      42,
    );
    expect(calls[0]?.sql).not.toContain('*');
    expect(calls[0]?.params).toEqual(['BrightProperties', TIER]);
  });
});

describe('BrightStagingStore — feed tier isolation (#314)', () => {
  it('scopes commitBatch, readCursor and resetCursor SQL to the given feed_tier', async () => {
    const { pool, calls } = createFakePool();
    const store = createStagingStoreOver(pool);

    await store.commitBatch({
      resource: 'BrightProperties',
      feedTier: 'production',
      runId: RUN_ID,
      records: stagedRecords(1),
      cursor: CURSOR,
    });
    const insert = calls.find((call) => call.sql.includes('INSERT INTO bright_staging_records'));
    expect(insert?.params).toContain('production');
    const cursorUpsert = calls.find((call) =>
      call.sql.includes('INSERT INTO bright_replication_cursor'),
    );
    expect(cursorUpsert?.sql).toContain('ON CONFLICT (feed_tier, resource)');
    expect(cursorUpsert?.params).toContain('production');
  });

  it('binds the feed tier alongside the resource for readCursor, countStaged and readRecordKeys', async () => {
    const { pool, calls } = createFakePool({ selectRows: [] });
    const store = createStagingStoreOver(pool);

    await store.readCursor('BrightProperties', 'production');
    await store.countStaged('BrightProperties', 'production');
    await store.readRecordKeys('BrightProperties', 'production');

    for (const call of calls) {
      expect(call.sql).toContain('feed_tier = $2');
      expect(call.params).toEqual(['BrightProperties', 'production']);
    }
  });
});
