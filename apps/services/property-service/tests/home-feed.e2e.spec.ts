import axios from 'axios';
import { homeFeedResponseSchema } from '@cribstop/property-contracts';
import { findFallbackCandidates } from '../src/home-feed/candidates';
import { closePool, getPool } from '../src/db/pool';
import {
  COLLAPSE_CITY,
  COLLAPSE_STATE,
  type HomeInput,
  removeCollapseFixtures,
  repriceRecord,
  type SeededHome,
  seedHomes,
} from './support/collapse-fixtures';

/**
 * #835. `POST /home-feed` against a REAL service and database. The fixtures sit around 20.5, 20.5.
 * Near homes lie within 8 km. Far homes lie about 55 km away. One home has no photo and one hides
 * its address, so neither can be placed.
 */
const pool = getPool();
const OFFICES = ['E2E Office A', 'E2E Office B', 'E2E Office C', 'E2E Office D', 'E2E Office E'];
const NEAR = 30;
// One clock per run for every fixture date. The service reads the real clock, so the 7-day and
// 14-day freshness windows stay filled. Truncation to the UTC hour keeps the value stable in a run.
const HOUR_MS = 3_600_000;
const NOW = Math.floor(Date.now() / HOUR_MS) * HOUR_MS;
const DAY_MS = 86_400_000;

const near = (i: number): HomeInput => ({
  street: `${i + 1} Near Ln`,
  zip: `0${String(100 + i)}`,
  latitude: 20.5 + (i % 6) * 0.01,
  longitude: 20.5 + Math.floor(i / 6) * 0.01,
  records: [
    {
      listPrice: 250000 + i * 30000,
      office: OFFICES[i % OFFICES.length],
      listedAt: new Date(NOW - (i % 15) * DAY_MS).toISOString(),
    },
  ],
});

const HOMES: HomeInput[] = [
  ...Array.from({ length: NEAR }, (_, i) => near(i)),
  ...Array.from({ length: 4 }, (_, i) => ({
    street: `${i + 1} Far Ln`,
    latitude: 21.0,
    longitude: 20.5 + i * 0.01,
    records: [{ listPrice: 300000, office: OFFICES[i % OFFICES.length] }],
  })),
  { street: '1 No Photo Ln', records: [{ listPrice: 310000 }] },
  { street: '1 Hidden Ln', records: [{ listPrice: 320000, addressHidden: true }] },
];

let seeded: Record<string, SeededHome>;
const idsOf = (pattern: RegExp): string[] =>
  Object.entries(seeded)
    .filter(([street]) => pattern.test(street))
    .flatMap(([, home]) => home.ids);

const BODY = {
  target: { city: COLLAPSE_CITY, state: COLLAPSE_STATE },
  radiusKm: 8,
  side: 'sale',
};

async function feed(body: object = BODY) {
  const response = await axios.post('/home-feed', body, { validateStatus: () => true });
  return response;
}

beforeAll(async () => {
  seeded = await seedHomes(pool, HOMES);
  for (const [street, home] of Object.entries(seeded)) {
    if (street.includes('No Photo')) continue;
    for (const id of home.ids) {
      await pool.query(
        `INSERT INTO listing_media (id, listing_id, source_url, alt_text, sort_order, is_primary,
                                    retained_when_suppressed, is_sample)
         SELECT gen_random_uuid(), $1::uuid, 'https://example.com/e2e/' || $1 || '/' || n,
                'E2E photo', n, n = 0, false, true
         FROM generate_series(0, 2) n`,
        [id],
      );
    }
  }
  // Cut homes listed 8 to 14 days ago. They sit outside the 7-day new window, so the price-drop
  // row, which builds after the fresh row, still finds them. The near row takes 8 first.
  const cut = Array.from({ length: NEAR }, (_, i) => i).filter((i) => i % 15 >= 8);
  for (const [n, i] of cut.entries()) {
    const street = `${i + 1} Near Ln`;
    await repriceRecord(
      pool,
      seeded[street] as SeededHome,
      0,
      200000 + n * 1000,
      new Date(NOW).toISOString(),
    );
  }
});

afterAll(async () => {
  await removeCollapseFixtures(pool);
  await closePool();
});

describe('POST /home-feed (#835)', () => {
  it('returns schema-valid rows with modelVersion and variant on every row', async () => {
    const response = await feed();
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = homeFeedResponseSchema.parse(response.data);
    expect(body.rows.length).toBeGreaterThan(0);
    for (const row of body.rows) {
      expect(row.modelVersion).toBe(body.modelVersion);
      expect(row.variant).toBe('v1');
      expect(row.listings.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('keeps the radius, the photo rule and the address rule', async () => {
    const body = homeFeedResponseSchema.parse((await feed()).data);
    const shown = body.rows.flatMap((row) => row.listings.map((l) => l.listing.id));
    expect(shown.length).toBeGreaterThan(8);
    for (const id of [...idsOf(/Far Ln/), ...idsOf(/No Photo/), ...idsOf(/Hidden/)]) {
      expect(shown).not.toContain(id);
    }
  });

  it('fills the fresh-window rows', async () => {
    const body = homeFeedResponseSchema.parse((await feed()).data);
    // A fixture clock outside the 7-day or 14-day window empties these rows without failing elsewhere.
    for (const rowId of ['just-listed', 'price-drops']) {
      const row = body.rows.find((r) => r.rowId === rowId);
      expect(row?.listings.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('repeats no listing across rows and caps an office at 2 per row', async () => {
    const body = homeFeedResponseSchema.parse((await feed()).data);
    const shown = body.rows.flatMap((row) => row.listings.map((l) => l.listing.id));
    expect(new Set(shown).size).toBe(shown.length);
    for (const row of body.rows) {
      const perOffice = new Map<string, number>();
      for (const { listing } of row.listings) {
        perOffice.set(listing.officeName, (perOffice.get(listing.officeName) ?? 0) + 1);
      }
      expect(Math.max(...perOffice.values())).toBeLessThanOrEqual(2);
    }
  });

  it('starts a warm visit with the picked row', async () => {
    const viewed = idsOf(/^(1|2|3) Near Ln$/).map((listingId) => ({
      listingId,
      kind: 'view',
      side: 'sale',
      at: NOW,
    }));
    const response = await feed({
      ...BODY,
      profile: { items: viewed, places: ['Collapseville, ZZ'] },
      variant: 'arm-b',
    });
    const body = homeFeedResponseSchema.parse(response.data);
    expect(body.rows[0]?.rowId).toBe('picked');
    expect(body.variant).toBe('arm-b');
  });

  it('whole-state mode answers 200', async () => {
    const response = await feed({ ...BODY, radiusKm: null });
    expect(response.status).toBe(200);
    homeFeedResponseSchema.parse(response.data);
  });

  it('runs the fallback read against the real schema', async () => {
    const candidates = await findFallbackCandidates(pool as never, {
      side: 'sale',
      state: COLLAPSE_STATE,
    });
    expect(Array.isArray(candidates)).toBe(true);
  });

  it('rejects an unknown field with 400', async () => {
    expect((await feed({ ...BODY, crimeScore: 1 })).status).toBe(400);
  });

  // Wall-clock timing depends on machine load. It runs only when PROPERTY_SERVICE_PERF_ASSERT=1.
  it('answers a cold and a warm feed with the same shape on 20 calls', async () => {
    const times: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const started = Date.now();
      const response = await feed({ ...BODY, variant: `v${i}` });
      times.push(Date.now() - started);
      expect(response.status).toBe(200);
      const body = homeFeedResponseSchema.parse(response.data);
      expect(body.rows.length).toBeGreaterThan(0);
      for (const row of body.rows) {
        expect(row.listings.length).toBeGreaterThanOrEqual(4);
      }
    }
    if (process.env.PROPERTY_SERVICE_PERF_ASSERT === '1') {
      times.sort((a, b) => a - b);
      expect(times[Math.ceil(times.length * 0.95) - 1]).toBeLessThan(300);
    }
  });
});
