import { deleteSampleData, SAMPLE_DATA_DELETE_STATEMENTS } from '../db/write';
import { computeDatasetHash } from './dataset-hash';
import { mockListings } from './mock-listings';
import { isListingsTableEmpty, isSeedOnStartEnabled, seedOnStart } from './seed-on-start';

/**
 * The gate is the whole subject here: what stops a fabricated sample listing from appearing in a
 * production `property_db`, and — since #111's amendment made re-applying destructive — what stops a
 * bulk `DELETE ... WHERE is_sample` from firing anywhere it should not. Most assertions below are
 * about a condition NOT being met.
 *
 * As in `seed.spec.ts`, no real database is involved — the pool is a hand-rolled fake that answers
 * the shapes the seed path reads.
 */
interface FakeOptions {
  /** Rows returned for the emptiness probe. Empty array => an empty table. */
  existingListings?: unknown[];
  /** The hash recorded in `seed_state`, or null for a database that has never been seeded. */
  appliedHash?: string | null;
}

function createFakePool({ existingListings = [], appliedHash = null }: FakeOptions = {}): {
  pool: { connect: jest.Mock };
  queries: string[];
  connects: () => number;
  releases: () => number;
} {
  const queries: string[] = [];
  let releases = 0;
  let idCounter = 0;

  const client = {
    query: jest.fn((text: string) => {
      queries.push(text);

      if (text.includes('SELECT 1 FROM listings LIMIT 1')) {
        return Promise.resolve({ rows: existingListings });
      }
      if (text.includes('FROM seed_state')) {
        return Promise.resolve({
          rows: appliedHash === null ? [] : [{ applied_hash: appliedHash }],
        });
      }
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
      if (text.includes('FROM listings l JOIN listing_statuses')) {
        return Promise.resolve({ rows: [] });
      }
      if (text.includes('RETURNING id')) {
        idCounter += 1;
        return Promise.resolve({ rows: [{ id: `generated-${idCounter}` }] });
      }
      return Promise.resolve({ rows: [] });
    }),
    release: jest.fn(() => {
      releases += 1;
    }),
  };

  const connect = jest.fn(() => Promise.resolve(client));
  return {
    pool: { connect },
    queries,
    connects: () => connect.mock.calls.length,
    releases: () => releases,
  };
}

const enabled = { PROPERTY_SERVICE_SEED_ON_START: '1', NODE_ENV: 'development' };
const currentHash = computeDatasetHash();
const populated = [{ '?column?': 1 }];

const deletes = (queries: string[]): string[] => queries.filter((q) => /DELETE\s+FROM/i.test(q));

describe('isSeedOnStartEnabled', () => {
  it('is disabled when the flag is absent', () => {
    expect(isSeedOnStartEnabled({ NODE_ENV: 'development' })).toBe(false);
  });

  it('is disabled for any flag value other than exactly "1"', () => {
    for (const value of ['', '0', 'true', 'yes', 'TRUE', ' 1']) {
      expect(
        isSeedOnStartEnabled({ PROPERTY_SERVICE_SEED_ON_START: value, NODE_ENV: 'development' }),
      ).toBe(false);
    }
  });

  it('is enabled when the flag is exactly "1"', () => {
    expect(isSeedOnStartEnabled(enabled)).toBe(true);
  });

  // The production refusal is independent of the flag, and asymmetric on purpose: an unset flag in
  // production is the normal case and stays quiet, while the flag SET in production is a
  // misconfiguration that must not be absorbed silently.
  it('is disabled under NODE_ENV=production even with no flag, without throwing', () => {
    expect(isSeedOnStartEnabled({ NODE_ENV: 'production' })).toBe(false);
  });

  it('throws under NODE_ENV=production when the flag is set', () => {
    expect(() =>
      isSeedOnStartEnabled({ PROPERTY_SERVICE_SEED_ON_START: '1', NODE_ENV: 'production' }),
    ).toThrow(/NODE_ENV=production/);
  });
});

describe('isListingsTableEmpty', () => {
  it('reports empty only when the probe returns no rows', async () => {
    const emptyClient = { query: jest.fn(() => Promise.resolve({ rows: [] })) };
    const populatedClient = { query: jest.fn(() => Promise.resolve({ rows: populated })) };

    await expect(isListingsTableEmpty(emptyClient)).resolves.toBe(true);
    await expect(isListingsTableEmpty(populatedClient)).resolves.toBe(false);
  });
});

describe('computeDatasetHash', () => {
  it('is stable for an unchanged dataset, so a rebuild alone never re-seeds', () => {
    expect(computeDatasetHash()).toBe(computeDatasetHash());
  });

  it('changes when the dataset changes — including when a listing is only removed', () => {
    expect(computeDatasetHash(mockListings.slice(0, -1))).not.toBe(currentHash);
    expect(
      computeDatasetHash([{ ...mockListings[0], price: 1 } as (typeof mockListings)[0]]),
    ).not.toBe(currentHash);
  });
});

// The destructive half. These are the assertions that would fail if a future edit let the bulk
// delete escape its scope.
describe('deleteSampleData statements', () => {
  it('scopes every single delete on is_sample = true', () => {
    expect(SAMPLE_DATA_DELETE_STATEMENTS.length).toBeGreaterThan(0);
    for (const statement of SAMPLE_DATA_DELETE_STATEMENTS) {
      expect(statement).toMatch(/is_sample = true/);
    }
  });

  it('deletes the RESTRICT-referencing history before the listings it references', () => {
    const index = (table: string): number =>
      SAMPLE_DATA_DELETE_STATEMENTS.findIndex((s) => new RegExp(`DELETE FROM ${table}\\b`).test(s));

    // listing_events is ON DELETE RESTRICT on both listings and properties, so this ordering is the
    // difference between a working re-seed and a foreign-key violation.
    expect(index('listing_events')).toBeGreaterThanOrEqual(0);
    expect(index('listing_events')).toBeLessThan(index('listings'));
    expect(index('listings')).toBeLessThan(index('properties'));
    expect(index('units')).toBeLessThan(index('properties'));
    expect(index('properties')).toBeLessThan(index('communities'));
  });

  it('spares a durable row that a surviving listing still references', () => {
    const properties = SAMPLE_DATA_DELETE_STATEMENTS.find((s) => /DELETE FROM properties/.test(s));
    // PRD §6.3: a real listing may legitimately attach to a property the seed created. That property
    // is itself is_sample, so only the NOT EXISTS guard keeps the re-seed from deleting it out from
    // under real inventory.
    expect(properties).toMatch(
      /NOT EXISTS \(SELECT 1 FROM listings l WHERE l\.property_id = p\.id\)/,
    );
  });

  // The constant is only a useful guarantee if it is what actually executes. Without this, a future
  // edit could add an unscoped delete directly in the function body and every assertion above would
  // still pass.
  it('executes exactly the audited statements and nothing else', async () => {
    const issued: string[] = [];
    const client = {
      query: jest.fn((text: string) => {
        issued.push(text);
        return Promise.resolve({ rows: [] });
      }),
    };

    await deleteSampleData(client);
    expect(issued).toEqual([...SAMPLE_DATA_DELETE_STATEMENTS]);
  });
});

describe('seedOnStart', () => {
  it('writes nothing at all when the flag is unset — it never opens a connection', async () => {
    const { pool, connects, queries } = createFakePool({ existingListings: populated });
    await expect(seedOnStart(pool, { NODE_ENV: 'development' })).resolves.toBe('skipped-disabled');
    expect(connects()).toBe(0);
    expect(deletes(queries)).toHaveLength(0);
  });

  it('writes nothing under NODE_ENV=production with no flag', async () => {
    const { pool, connects, queries } = createFakePool({ existingListings: populated });
    await expect(seedOnStart(pool, { NODE_ENV: 'production' })).resolves.toBe('skipped-disabled');
    expect(connects()).toBe(0);
    expect(deletes(queries)).toHaveLength(0);
  });

  it('refuses loudly, before connecting or deleting, when the flag is set in production', async () => {
    const { pool, connects, queries } = createFakePool({ existingListings: populated });
    await expect(
      seedOnStart(pool, { PROPERTY_SERVICE_SEED_ON_START: '1', NODE_ENV: 'production' }),
    ).rejects.toThrow(/NODE_ENV=production/);
    expect(connects()).toBe(0);
    expect(deletes(queries)).toHaveLength(0);
  });

  it('seeds an empty table and records the dataset hash', async () => {
    const { pool, queries } = createFakePool();
    await expect(seedOnStart(pool, enabled)).resolves.toBe('seeded');
    expect(queries.filter((q) => q.includes('INSERT INTO listings')).length).toBeGreaterThan(0);
    expect(queries.some((q) => q.includes('INSERT INTO seed_state'))).toBe(true);
    expect(queries).toContain('COMMIT');
    // A first seed has nothing to remove, so it must not run the destructive path.
    expect(deletes(queries)).toHaveLength(0);
  });

  // The no-op case, and the reason the hash is over dataset CONTENT: a redeploy that changed no data
  // must not delete and rewrite the database.
  it('is completely inert when the recorded hash matches the current dataset', async () => {
    const { pool, queries } = createFakePool({
      existingListings: populated,
      appliedHash: currentHash,
    });
    await expect(seedOnStart(pool, enabled)).resolves.toBe('skipped-current');
    expect(deletes(queries)).toHaveLength(0);
    expect(queries.filter((q) => q.includes('INSERT INTO'))).toHaveLength(0);
    expect(queries).not.toContain('BEGIN');
  });

  it('re-seeds when the dataset changed, removing the old sample rows first', async () => {
    const { pool, queries } = createFakePool({
      existingListings: populated,
      appliedHash: 'a-hash-from-an-older-dataset',
    });
    await expect(seedOnStart(pool, enabled)).resolves.toBe('reseeded');

    expect(deletes(queries)).toHaveLength(SAMPLE_DATA_DELETE_STATEMENTS.length);
    // Deleting and re-inserting in one transaction is what keeps the database from being observably
    // empty — and from staying empty if the insert fails.
    const begin = queries.indexOf('BEGIN');
    const firstDelete = queries.findIndex((q) => /DELETE\s+FROM/i.test(q));
    const firstInsert = queries.findIndex((q) => q.includes('INSERT INTO listings'));
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(firstDelete).toBeGreaterThan(begin);
    expect(firstInsert).toBeGreaterThan(firstDelete);
    expect(queries[queries.length - 1]).toBe('COMMIT');
  });

  it('re-seeds a populated database that has no recorded hash at all', async () => {
    const { pool } = createFakePool({ existingListings: populated, appliedHash: null });
    await expect(seedOnStart(pool, enabled)).resolves.toBe('reseeded');
  });

  it('releases the probe client whether or not it goes on to seed', async () => {
    const current = createFakePool({ existingListings: populated, appliedHash: currentHash });
    await seedOnStart(current.pool, enabled);
    expect(current.releases()).toBe(1);

    const empty = createFakePool();
    await seedOnStart(empty.pool, enabled);
    // One release for the probe, one for the connection runSeed() takes.
    expect(empty.releases()).toBe(2);
  });
});
