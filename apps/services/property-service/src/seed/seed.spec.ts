import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { mockListings } from './mock-listings';
import { runSeed } from './seed';

/**
 * `runSeed` is exercised against a hand-rolled fake pg client/pool — no real database connection is ever
 * made. This mirrors the pattern used for `app.spec.ts` but for the `pg.Pool` boundary.
 *
 * The fake has to answer two kinds of read now, because the write path resolves each listing's dwelling
 * snapshot from durable truth rather than trusting its caller:
 *   - `INSERT ... RETURNING id` must return an id.
 *   - the `SELECT ... FROM properties p` fact resolution must return a row.
 * A fake returning `{ rows: [] }` for everything makes the seed throw — which is itself the point: there
 * is no code path that writes a listing without first reading the property it belongs to.
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
  let idCounter = 0;

  const client = {
    query: jest.fn((text: string, values?: unknown[]) => {
      queries.push({ text, values });

      // Dwelling-fact resolution for the snapshot.
      if (text.includes('FROM properties p')) {
        return Promise.resolve({
          rows: [
            {
              beds: 3,
              baths_full: 2,
              baths_half: 1,
              living_sqft: 2000,
              lot_sqft: 5000,
              year_built: 1990,
              neighborhood: 'Downtown',
              city: 'Baltimore',
              state: 'MD',
              zip5: '21201',
              latitude: 39.29,
              longitude: -76.61,
              is_sample: true,
            },
          ],
        });
      }
      // The terminal-status guard: nothing exists yet in a fresh seed.
      if (text.includes('FROM listings l JOIN listing_statuses')) {
        return Promise.resolve({ rows: [] });
      }
      if (text.includes('RETURNING id')) {
        idCounter += 1;
        return Promise.resolve({ rows: [{ id: `generated-${idCounter}` }] });
      }
      return Promise.resolve({ rows: [] });
    }),
    release: jest.fn(),
  };

  return { pool: { connect: jest.fn(() => Promise.resolve(client)) }, client, queries };
}

const insertsInto = (queries: RecordedQuery[], table: string): RecordedQuery[] =>
  queries.filter((q) => q.text.includes(`INSERT INTO ${table}`));

/**
 * Resolves the value bound to a named column of an INSERT by parsing the column list, rather than
 * hardcoding a `$n` offset — adding a column must not silently point these assertions at a neighbour.
 */
const boundValue = (insert: RecordedQuery, column: string): unknown => {
  const columnList = insert.text.slice(insert.text.indexOf('(') + 1, insert.text.indexOf(')'));
  const columns = columnList.split(',').map((c) => c.trim());
  const index = columns.indexOf(column);
  expect(index).toBeGreaterThanOrEqual(0);
  return insert.values?.[index];
};

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

  it('inserts a community before any property or listing row', async () => {
    const { pool, queries } = createFakePool();
    await runSeed(pool);

    const community = queries.findIndex((q) => q.text.includes('INSERT INTO communities'));
    const property = queries.findIndex((q) => q.text.includes('INSERT INTO properties'));
    const listing = queries.findIndex((q) => q.text.includes('INSERT INTO listings'));

    expect(community).toBeGreaterThanOrEqual(0);
    expect(property).toBeGreaterThan(community);
    expect(listing).toBeGreaterThan(property);
  });

  it('seeds every mock listing as a listings row', async () => {
    const { pool, queries } = createFakePool();
    await runSeed(pool);
    expect(insertsInto(queries, 'listings')).toHaveLength(mockListings.length);
  });

  it('resolves properties by deduplication key, so one building is not stored twice', async () => {
    const { pool, queries } = createFakePool();
    await runSeed(pool);

    const propertyInserts = insertsInto(queries, 'properties');
    const distinctAddressKeys = new Set(
      propertyInserts.map((insert) => boundValue(insert, 'address_key')),
    );

    // The dataset deliberately holds two listings on '1200 Harbor View Dr', so there is one fewer
    // building than there are listings. This is the property -> N listings case the schema exists for,
    // and before this change the seed produced one property per listing with no dedup at all.
    expect(distinctAddressKeys.size).toBe(mockListings.length - 1);
    for (const insert of propertyInserts) {
      expect(insert.text).toContain('ON CONFLICT (address_key)');
    }
  });

  it('reads durable facts before writing each listing snapshot', async () => {
    const { pool, queries } = createFakePool();
    await runSeed(pool);
    expect(queries.filter((q) => q.text.includes('FROM properties p'))).toHaveLength(
      mockListings.length,
    );
  });

  it('forces source to internal on every listing insert, regardless of mock data', async () => {
    const { pool, queries } = createFakePool();
    await runSeed(pool);

    const inserts = insertsInto(queries, 'listings');
    expect(inserts).toHaveLength(mockListings.length);
    for (const insert of inserts) {
      expect(boundValue(insert, 'source')).toBe('internal');
    }
  });

  it('flags every seeded listing as sample data (compliance-critical)', async () => {
    const { pool, queries } = createFakePool();
    await runSeed(pool);

    for (const insert of insertsInto(queries, 'listings')) {
      expect(boundValue(insert, 'is_sample')).toBe(true);
      expect(boundValue(insert, 'title')).toEqual(expect.stringContaining('(Sample)'));
    }
  });

  it('inserts a unit row only for addresses that name a sub-unit', async () => {
    const { pool, queries } = createFakePool();
    await runSeed(pool);

    const expectedUnits = mockListings.filter((listing) =>
      /\b(?:Unit|Apt|Suite|Ste|Loft|#)\.?\s*[A-Za-z0-9-]+|\bPH\d+/i.test(listing.address),
    ).length;

    // Units stay optional (PRD §3): a single-family home gets no synthetic placeholder row.
    expect(insertsInto(queries, 'units')).toHaveLength(expectedUnits);
    expect(expectedUnits).toBeLessThan(mockListings.length);
  });

  it('records listing history, open houses, and media as child rows', async () => {
    const { pool, queries } = createFakePool();
    await runSeed(pool);

    expect(insertsInto(queries, 'listing_events')).toHaveLength(mockListings.length);
    expect(insertsInto(queries, 'listing_open_houses')).toHaveLength(
      mockListings.filter((listing) => listing.openHouse).length,
    );
    expect(insertsInto(queries, 'listing_media')).toHaveLength(
      mockListings.reduce((total, listing) => total + listing.imageUrls.length, 0),
    );
  });

  it('rolls back and rethrows when a write fails', async () => {
    const seen: string[] = [];
    const client = {
      query: jest.fn((text: string) => {
        seen.push(text);
        if (text.includes('INSERT INTO properties')) {
          return Promise.reject(new Error('boom'));
        }
        return Promise.resolve({ rows: [] });
      }),
      release: jest.fn(),
    };
    const pool = { connect: jest.fn(() => Promise.resolve(client)) };

    await expect(runSeed(pool)).rejects.toThrow('boom');
    expect(seen).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});

describe('listings write path', () => {
  /**
   * The dwelling snapshot on `listings` is drift-capable by construction: no database constraint can
   * assert it equals COALESCE(unit, property), because for a terminal listing that equality is
   * deliberately false. The containment is therefore structural — exactly one module writes the table.
   *
   * This test is that enforcement. If it fails, do not add another writer; extend src/db/write.ts.
   */
  it('is confined to src/db/write.ts', () => {
    const serviceRoot = join(__dirname, '..', '..');
    const shouldNotWriteListings = [
      'src/seed/seed.ts',
      'src/seed/transform.ts',
      'src/app.ts',
      'src/main.ts',
      'src/db/pool.ts',
    ];

    for (const relativePath of shouldNotWriteListings) {
      const contents = readFileSync(join(serviceRoot, relativePath), 'utf8');
      expect(contents).not.toMatch(/INSERT\s+INTO\s+listings\b/i);
      expect(contents).not.toMatch(/UPDATE\s+listings\b/i);
    }
  });
});
