import {
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

describe('BrightStagingStore — commitBatch', () => {
  it('wraps the batch in BEGIN and COMMIT', async () => {
    const { pool, calls } = createFakePool();

    await createStagingStoreOver(pool).commitBatch({
      resource: 'BrightProperties',
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
      runId: RUN_ID,
      records: stagedRecords(2500),
      cursor: CURSOR,
    });

    const inserts = calls.filter((call) => call.sql.includes('INSERT INTO bright_staging_records'));
    expect(inserts.length).toBe(3);
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
      runId: RUN_ID,
      records: stagedRecords(1),
      cursor: CURSOR,
    });
    expect(good.released()).toBe(1);

    const bad = createFakePool({ failInsert: true });
    await expect(
      createStagingStoreOver(bad.pool).commitBatch({
        resource: 'BrightProperties',
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

    await expect(createStagingStoreOver(pool).readCursor('BrightProperties')).resolves.toEqual({
      modifiedAt: null,
      recordKey: null,
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

    await expect(createStagingStoreOver(pool).readCursor('BrightProperties')).resolves.toEqual({
      modifiedAt: '2026-09-18T12:00:00.000Z',
      recordKey: 'key-9',
    });
  });
});

describe('BrightStagingStore — resetCursor', () => {
  it('nulls both cursor columns and deletes no staged rows', async () => {
    const { pool, calls } = createFakePool();

    await createStagingStoreOver(pool).resetCursor('BrightProperties', RUN_ID);

    const cursorCall = calls.find((call) =>
      call.sql.includes('INSERT INTO bright_replication_cursor'),
    );
    expect(cursorCall?.sql).toContain('cursor_modified_at = NULL');
    expect(cursorCall?.sql).toContain('cursor_record_key = NULL');
    expect(cursorCall?.params).toContain(null);
    expect(calls.some((call) => /DELETE|TRUNCATE/i.test(call.sql))).toBe(false);
  });
});

describe('BrightStagingStore — countStaged', () => {
  it('reads the row count for one resource', async () => {
    const { pool, calls } = createFakePool({ selectRows: [{ staged: '42' }] });

    await expect(createStagingStoreOver(pool).countStaged('BrightProperties')).resolves.toBe(42);
    expect(calls[0]?.sql).not.toContain('*');
    expect(calls[0]?.params).toEqual(['BrightProperties']);
  });
});
