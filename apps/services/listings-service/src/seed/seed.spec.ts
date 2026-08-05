import { runSeed } from './seed';

/**
 * `runSeed` is exercised against a hand-rolled fake pg client/pool — no real
 * database connection is ever made. This mirrors the pattern used for
 * `app.spec.ts` but for the `pg.Pool` boundary instead of an HTTP boundary.
 */
interface RecordedQuery {
  text: string;
  values?: unknown[];
}

function createFakePool(): {
  pool: { connect: jest.Mock };
  client: { query: jest.Mock; release: jest.Mock };
  queries: RecordedQuery[];
} {
  const queries: RecordedQuery[] = [];
  const client = {
    query: jest.fn((text: string, values?: unknown[]) => {
      queries.push({ text, values });
      return Promise.resolve({ rows: [] });
    }),
    release: jest.fn(),
  };
  const pool = {
    connect: jest.fn(() => Promise.resolve(client)),
  };
  return { pool, client, queries };
}

describe('runSeed', () => {
  it('connects a single client and releases it when done', async () => {
    const { pool, client } = createFakePool();

    await runSeed(pool);

    expect(pool.connect).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('wraps all writes in a transaction (BEGIN ... COMMIT)', async () => {
    const { pool, queries } = createFakePool();

    await runSeed(pool);

    expect(queries[0]?.text).toBe('BEGIN');
    expect(queries[queries.length - 1]?.text).toBe('COMMIT');
  });

  it('inserts at least one community row before any property/listing row', async () => {
    const { pool, queries } = createFakePool();

    await runSeed(pool);

    const firstCommunityIdx = queries.findIndex((q) => q.text.includes('INSERT INTO communities'));
    const firstPropertyIdx = queries.findIndex((q) => q.text.includes('INSERT INTO properties'));
    const firstListingIdx = queries.findIndex((q) => q.text.includes('INSERT INTO listings'));

    expect(firstCommunityIdx).toBeGreaterThanOrEqual(0);
    expect(firstPropertyIdx).toBeGreaterThan(firstCommunityIdx);
    expect(firstListingIdx).toBeGreaterThan(firstPropertyIdx);
  });

  it('seeds every mock listing as a listings row', async () => {
    const { pool, queries } = createFakePool();

    await runSeed(pool);

    const listingInserts = queries.filter((q) => q.text.includes('INSERT INTO listings'));
    // 12 base mock listings ported from the frontend dataset.
    expect(listingInserts).toHaveLength(12);
  });

  /**
   * Resolves the value bound to a named column of an `INSERT INTO listings`
   * statement by parsing the column list, rather than hardcoding a `$n`
   * offset — adding a column shouldn't silently point these assertions at a
   * neighbouring value.
   */
  const boundValue = (insert: { text: string; values?: unknown[] }, column: string): unknown => {
    const columnList = insert.text.slice(insert.text.indexOf('(') + 1, insert.text.indexOf(')'));
    const columns = columnList.split(',').map((c) => c.trim());
    const index = columns.indexOf(column);
    expect(index).toBeGreaterThanOrEqual(0);
    return insert.values?.[index];
  };

  it('forces source to internal on every listing insert, regardless of mock data', async () => {
    const { pool, queries } = createFakePool();

    await runSeed(pool);

    const listingInserts = queries.filter((q) => q.text.includes('INSERT INTO listings'));
    expect(listingInserts).toHaveLength(12);
    for (const insert of listingInserts) {
      expect(boundValue(insert, 'source')).toBe('internal');
    }
  });

  it('flags every seeded listing as sample data (compliance-critical)', async () => {
    const { pool, queries } = createFakePool();

    await runSeed(pool);

    const listingInserts = queries.filter((q) => q.text.includes('INSERT INTO listings'));
    expect(listingInserts).toHaveLength(12);
    for (const insert of listingInserts) {
      expect(boundValue(insert, 'is_sample')).toBe(true);
      expect(boundValue(insert, 'title')).toEqual(expect.stringContaining('(Sample)'));
    }
  });

  it('inserts a unit row for addresses that reference a sub-unit (e.g. Unit 1201)', async () => {
    const { pool, queries } = createFakePool();

    await runSeed(pool);

    const unitInserts = queries.filter((q) => q.text.includes('INSERT INTO units'));
    expect(unitInserts.length).toBeGreaterThan(0);
  });

  it('rolls back and rethrows when a write fails', async () => {
    const queries: string[] = [];
    const client = {
      query: jest.fn((text: string) => {
        queries.push(text);
        if (text.includes('INSERT INTO properties')) {
          return Promise.reject(new Error('boom'));
        }
        return Promise.resolve({ rows: [] });
      }),
      release: jest.fn(),
    };
    const pool = { connect: jest.fn(() => Promise.resolve(client)) };

    await expect(runSeed(pool)).rejects.toThrow('boom');
    expect(queries).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
