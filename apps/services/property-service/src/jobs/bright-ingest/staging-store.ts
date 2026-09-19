import { getPool } from '../../db/pool';

/**
 * THE ONLY MODULE THAT WRITES THE BRIGHT REPLICATION STAGING TABLES (#92).
 *
 * `bright_staging_records` and `bright_replication_cursor` hold the feed as Bright returned it.
 * They are staging, not inventory: #93 maps out of them, and `src/db/write.ts` stays the only
 * module that writes a consumer table. Nothing here names a consumer table or the consumer read
 * view, and a sibling spec asserts that structurally.
 */

/** One Bright record on its way into staging. `payload` is the record verbatim. */
export interface StagedRecord {
  readonly recordKey: string;
  /** ISO-8601 instant, `Z`-suffixed. */
  readonly modifiedAt: string;
  readonly payload: unknown;
}

/** Where a resource's replication has reached. Both fields are null before the first run. */
export interface ReplicationCursor {
  readonly modifiedAt: string | null;
  readonly recordKey: string | null;
}

export interface BrightStagingStore {
  readCursor(resource: string): Promise<ReplicationCursor>;
  /**
   * Upserts the batch and advances the cursor in ONE transaction, so a crash between the two is
   * impossible. Returns the number of rows written.
   */
  commitBatch(params: {
    resource: string;
    runId: string;
    records: readonly StagedRecord[];
    cursor: ReplicationCursor;
  }): Promise<number>;
  /** Clears the cursor so the next pass starts from the configured epoch. Staged rows stay. */
  resetCursor(resource: string, runId: string): Promise<void>;
  /** Row count in staging for one resource. Used by the run report. */
  countStaged(resource: string): Promise<number>;
}

/**
 * The narrow seam this module needs, so a unit test can drive the store with a fake and no
 * database. A real `pg.PoolClient` satisfies it structurally. Same shape as `src/seed/seed.ts`.
 */
export interface Queryable {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}

export interface StagingQueryable extends Queryable {
  release: () => void;
}

export interface StagingConnectable {
  connect: () => Promise<StagingQueryable>;
}

/**
 * Postgres caps a statement at 65535 bound parameters, and a Bright page is up to 1000 records
 * wide. Five parameters per record puts the record cap first, so it is the one that binds. Chunks
 * stay inside the same transaction, so a split batch is still all-or-nothing.
 */
const MAX_RECORDS_PER_STATEMENT = 1000;
const MAX_PARAMETERS_PER_STATEMENT = 30000;
const PARAMETERS_PER_RECORD = 5;
const CHUNK_SIZE = Math.min(
  MAX_RECORDS_PER_STATEMENT,
  Math.floor(MAX_PARAMETERS_PER_STATEMENT / PARAMETERS_PER_RECORD),
);

const READ_CURSOR_SQL = `SELECT cursor_modified_at, cursor_record_key
   FROM bright_replication_cursor
  WHERE resource = $1`;

const COUNT_STAGED_SQL = `SELECT count(1) AS staged
   FROM bright_staging_records
  WHERE resource = $1`;

/**
 * `fetched_at` is advanced by this statement rather than by a trigger, because the writer owns it.
 * `first_seen_at` is deliberately absent from the update: it records the first time this run set
 * ever saw the record, and a re-read at a tie boundary must not move it.
 */
const UPSERT_CONFLICT_SQL = `ON CONFLICT (resource, record_key) DO UPDATE
     SET modified_at = EXCLUDED.modified_at,
         payload = EXCLUDED.payload,
         run_id = EXCLUDED.run_id,
         fetched_at = now()`;

/**
 * `last_run_at` takes its column default on insert and is advanced explicitly on conflict — a
 * `now()` literal inside the VALUES list would consume no placeholder and silently shift every
 * later column out of step with its bound value.
 */
const UPSERT_CURSOR_SQL = `INSERT INTO bright_replication_cursor
         (resource, cursor_modified_at, cursor_record_key, last_run_id, records_staged)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (resource) DO UPDATE
         SET cursor_modified_at = EXCLUDED.cursor_modified_at,
             cursor_record_key = EXCLUDED.cursor_record_key,
             last_run_id = EXCLUDED.last_run_id,
             last_run_at = now(),
             records_staged = bright_replication_cursor.records_staged + $5`;

const RESET_CURSOR_SQL = `INSERT INTO bright_replication_cursor
         (resource, cursor_modified_at, cursor_record_key, last_run_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (resource) DO UPDATE
         SET cursor_modified_at = NULL,
             cursor_record_key = NULL,
             last_run_id = EXCLUDED.last_run_id,
             last_run_at = now()`;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}

/**
 * Builds the placeholder list and the flat parameter array together, so the two cannot drift. Every
 * column in the VALUES list is bound; nothing is written as a literal.
 */
function buildUpsert(
  resource: string,
  runId: string,
  records: readonly StagedRecord[],
): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const tuples = records.map((record) => {
    const first = params.length;
    params.push(
      resource,
      record.recordKey,
      record.modifiedAt,
      JSON.stringify(record.payload),
      runId,
    );
    return `($${first + 1}, $${first + 2}, $${first + 3}, $${first + 4}, $${first + 5})`;
  });

  const sql =
    'INSERT INTO bright_staging_records (resource, record_key, modified_at, payload, run_id)\n' +
    `     VALUES ${tuples.join(', ')}\n     ${UPSERT_CONFLICT_SQL}`;
  return { sql, params };
}

/** `timestamptz` arrives as a `Date`; the wire format for this service is the `Z`-suffixed string. */
function instantOrNull(value: unknown): string | null {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return typeof value === 'string' ? new Date(value).toISOString() : null;
}

export function createStagingStoreOver(pool: StagingConnectable): BrightStagingStore {
  async function withClient<T>(work: (client: StagingQueryable) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      return await work(client);
    } finally {
      client.release();
    }
  }

  return {
    async readCursor(resource) {
      return withClient(async (client) => {
        const { rows } = await client.query(READ_CURSOR_SQL, [resource]);
        const row = rows[0];
        if (!row) {
          return { modifiedAt: null, recordKey: null };
        }
        const recordKey = row.cursor_record_key;
        return {
          modifiedAt: instantOrNull(row.cursor_modified_at),
          recordKey: typeof recordKey === 'string' ? recordKey : null,
        };
      });
    },

    async commitBatch({ resource, runId, records, cursor }) {
      return withClient(async (client) => {
        await client.query('BEGIN');
        try {
          let written = 0;
          for (const batch of chunk(records, CHUNK_SIZE)) {
            const { sql, params } = buildUpsert(resource, runId, batch);
            const result = await client.query(sql, params);
            written += result.rowCount ?? batch.length;
          }

          // An empty batch still advances the cursor, so a page of records the filter excluded does
          // not make the next pass re-read the same window forever.
          await client.query(UPSERT_CURSOR_SQL, [
            resource,
            cursor.modifiedAt,
            cursor.recordKey,
            runId,
            records.length,
          ]);

          await client.query('COMMIT');
          return written;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      });
    },

    async resetCursor(resource, runId) {
      await withClient(async (client) => {
        await client.query(RESET_CURSOR_SQL, [resource, null, null, runId]);
      });
    },

    async countStaged(resource) {
      return withClient(async (client) => {
        const { rows } = await client.query(COUNT_STAGED_SQL, [resource]);
        // `count()` is bigint, which node-postgres returns as a string.
        return Number(rows[0]?.staged ?? 0);
      });
    },
  };
}

export function createStagingStore(): BrightStagingStore {
  return createStagingStoreOver(getPool());
}
