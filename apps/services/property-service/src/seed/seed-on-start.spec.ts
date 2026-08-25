import { isListingsTableEmpty, isSeedOnStartEnabled, seedOnStart } from './seed-on-start';

/**
 * The gate is the whole subject here: what stops a fabricated sample listing from appearing in a
 * production `property_db`. Every assertion below is about a condition NOT being met.
 *
 * As in `seed.spec.ts`, no real database is involved — the pool is a hand-rolled fake that answers
 * the two shapes the seed path reads.
 */
interface FakeOptions {
  /** Rows returned for the emptiness probe. Empty array => an empty table. */
  existingListings?: unknown[];
}

function createFakePool({ existingListings = [] }: FakeOptions = {}): {
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
    const populatedClient = {
      query: jest.fn(() => Promise.resolve({ rows: [{ '?column?': 1 }] })),
    };

    await expect(isListingsTableEmpty(emptyClient)).resolves.toBe(true);
    await expect(isListingsTableEmpty(populatedClient)).resolves.toBe(false);
  });
});

describe('seedOnStart', () => {
  it('writes nothing at all when the flag is unset — it never opens a connection', async () => {
    const { pool, connects } = createFakePool();
    await expect(seedOnStart(pool, { NODE_ENV: 'development' })).resolves.toBe('skipped-disabled');
    expect(connects()).toBe(0);
  });

  it('writes nothing under NODE_ENV=production with no flag', async () => {
    const { pool, connects } = createFakePool();
    await expect(seedOnStart(pool, { NODE_ENV: 'production' })).resolves.toBe('skipped-disabled');
    expect(connects()).toBe(0);
  });

  it('refuses loudly, before connecting, when the flag is set in production', async () => {
    const { pool, connects } = createFakePool();
    await expect(
      seedOnStart(pool, { PROPERTY_SERVICE_SEED_ON_START: '1', NODE_ENV: 'production' }),
    ).rejects.toThrow(/NODE_ENV=production/);
    expect(connects()).toBe(0);
  });

  // Emptiness is the second condition. A re-run against a populated database must be a no-op rather
  // than a second pass that duplicates rows.
  it('is a no-op when listings already holds rows, even with the flag set', async () => {
    const { pool, queries } = createFakePool({ existingListings: [{ '?column?': 1 }] });
    await expect(seedOnStart(pool, enabled)).resolves.toBe('skipped-populated');
    expect(queries.filter((q) => q.includes('INSERT INTO'))).toHaveLength(0);
    expect(queries).not.toContain('BEGIN');
  });

  it('seeds when the flag is set, the environment is not production, and the table is empty', async () => {
    const { pool, queries } = createFakePool();
    await expect(seedOnStart(pool, enabled)).resolves.toBe('seeded');
    expect(queries.filter((q) => q.includes('INSERT INTO listings')).length).toBeGreaterThan(0);
    expect(queries).toContain('COMMIT');
  });

  it('releases the probe client whether or not it goes on to seed', async () => {
    const populated = createFakePool({ existingListings: [{ '?column?': 1 }] });
    await seedOnStart(populated.pool, enabled);
    expect(populated.releases()).toBe(1);

    const empty = createFakePool();
    await seedOnStart(empty.pool, enabled);
    // One release for the probe, one for the connection runSeed() takes.
    expect(empty.releases()).toBe(2);
  });
});
