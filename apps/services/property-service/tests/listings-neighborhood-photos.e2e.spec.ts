import axios from 'axios';
import { type NeighborhoodRow, neighborhoodsResponseSchema } from '@cribstop/property-contracts';
import { closePool, getPool } from '../src/db/pool';
import { assertFixturesEnabled } from './support/fixtures';

/**
 * #486. `GET /listings/neighborhoods` `previewPhotos` against a REAL service and REAL database.
 *
 * Each test seeds its own self-labelled neighborhood (`is_sample`) and removes it afterwards, so it
 * needs no shared fixture and asserts no absolute totals. A neighborhood is found by `slug`.
 */

const STATE = 'MD';
const CITY = 'E2E Preview City';
const RUN = Date.now().toString(36);

interface SeedListing {
  offerKind?: 'sale' | 'rent';
  /** Days before now the listing went on the market. Higher is older. */
  listedDaysAgo: number;
  photos?: number;
  mediaDisplayAllowed?: boolean;
  /** Marks the first photo `retained_when_suppressed`. */
  retained?: boolean;
}

let seq = 0;
const seededHoods: string[] = [];

async function seedHood(label: string, listings: SeedListing[]) {
  const name = `E2E Photo ${label} ${RUN}`;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const pool = getPool();
  const ids: string[] = [];
  for (const spec of listings) {
    seq += 1;
    const key = `e2e-preview-${RUN}-${seq}`;
    const property = await pool.query<{ id: string }>(
      `INSERT INTO properties (address_raw, street_line, city, state, zip5, address_key,
                               neighborhood, property_type, is_sample)
       VALUES ($1, $1, $2, $3, '21701', $4, $5, 'Single Family', true) RETURNING id`,
      [`${seq} Preview Fixture St`, CITY, STATE, key, name],
    );
    const listing = await pool.query<{ id: string }>(
      `INSERT INTO listings (property_id, title, offer_kind, status, source, list_price,
                             neighborhood, city, state, zip5, consumer_status, broker_name,
                             broker_phone, office_name, last_updated, listed_at,
                             media_display_allowed, is_sample)
       VALUES ($1, $2, $3, 'Active', 'internal', 400000, $4, $5, $6, '21701', 'Active',
               'Broker', '555-0100', 'Office', now(), now() - ($7 || ' days')::interval, $8, true)
       RETURNING id`,
      [
        property.rows[0]?.id,
        `E2E Fixture (Sample) ${key}`,
        spec.offerKind ?? 'sale',
        name,
        CITY,
        STATE,
        String(spec.listedDaysAgo),
        spec.mediaDisplayAllowed ?? true,
      ],
    );
    const id = listing.rows[0]?.id as string;
    ids.push(id);
    for (let n = 0; n < (spec.photos ?? 1); n += 1) {
      await pool.query(
        `INSERT INTO listing_media (listing_id, source_url, sort_order, is_primary,
                                    retained_when_suppressed, is_sample)
         VALUES ($1, $2, $3, $4, $5, true)`,
        [
          id,
          `https://cdn.example/e2e-preview/${id}-${n}.jpg`,
          n,
          n === 0,
          !!spec.retained && n === 0,
        ],
      );
    }
  }
  seededHoods.push(name);
  return { name, slug, ids };
}

async function fetchRow(
  slug: string,
  query: Record<string, string> = {},
): Promise<NeighborhoodRow | undefined> {
  const response = await axios.get('/listings/neighborhoods', {
    params: { slug, minCount: '1', state: STATE, city: CITY, ...query },
  });
  return neighborhoodsResponseSchema.parse(response.data).results[0];
}

beforeAll(() => {
  assertFixturesEnabled();
});

afterAll(async () => {
  const pool = getPool();
  for (const name of seededHoods) {
    await pool.query(
      'DELETE FROM listing_media WHERE listing_id IN (SELECT id FROM listings WHERE neighborhood = $1)',
      [name],
    );
    await pool.query('DELETE FROM listings WHERE neighborhood = $1', [name]);
    await pool.query('DELETE FROM properties WHERE neighborhood = $1', [name]);
  }
  await closePool();
});

describe('previewPhotos count', () => {
  it.each([0, 1, 3, 6])(
    'returns up to 5 photos, newest listed first, for %i qualifying sale listings',
    async (count) => {
      const { slug, ids } = await seedHood(
        `count${count}`,
        // A listing with no photo never counts toward the photos, but still counts in `sale`.
        [
          ...Array.from({ length: count }, (_, i) => ({ listedDaysAgo: i + 1 })),
          { listedDaysAgo: 0, photos: 0 },
        ],
      );

      const row = await fetchRow(slug);

      expect(row?.sale).toBe(count + 1);
      const expected = ids.slice(0, Math.min(count, 5));
      expect((row?.previewPhotos ?? []).map((p) => p.listingId)).toEqual(expected);
      if (count === 0) expect(row?.previewPhotos).toBeUndefined();
    },
  );

  it('gives one photo per listing, from different listings', async () => {
    const { slug } = await seedHood('onephoto', [
      { listedDaysAgo: 1, photos: 4 },
      { listedDaysAgo: 2, photos: 4 },
    ]);

    const row = await fetchRow(slug);

    const listingIds = (row?.previewPhotos ?? []).map((p) => p.listingId);
    expect(listingIds).toHaveLength(2);
    expect(new Set(listingIds).size).toBe(2);
    for (const photo of row?.previewPhotos ?? []) expect(photo.url).toMatch(/-0\.jpg$/);
  });

  it('returns identical arrays for identical requests', async () => {
    const { slug } = await seedHood('stable', [
      { listedDaysAgo: 3 },
      { listedDaysAgo: 3 },
      { listedDaysAgo: 3 },
    ]);

    const first = await fetchRow(slug);
    const second = await fetchRow(slug);

    expect(second?.previewPhotos).toEqual(first?.previewPhotos);
  });
});

describe('previewPhotos only come from the sale listings the tile links to', () => {
  it('gives a rent-only neighborhood no photos', async () => {
    const { slug } = await seedHood('rentonly', [
      { offerKind: 'rent', listedDaysAgo: 1 },
      { offerKind: 'rent', listedDaysAgo: 2 },
    ]);

    const row = await fetchRow(slug);

    expect(row?.rent).toBe(2);
    expect(row?.previewPhotos).toBeUndefined();
  });

  it('skips a rent listing in a mixed neighborhood', async () => {
    const { slug, ids } = await seedHood('mixed', [
      { offerKind: 'rent', listedDaysAgo: 1 },
      { listedDaysAgo: 2 },
    ]);

    const row = await fetchRow(slug);

    expect((row?.previewPhotos ?? []).map((p) => p.listingId)).toEqual([ids[1]]);
  });

  it.each(['all', 'sale', 'rent'])('returns the same photos for listingType=%s', async (type) => {
    const { slug, ids } = await seedHood(`type${type}`, [
      { listedDaysAgo: 1 },
      { offerKind: 'rent', listedDaysAgo: 2 },
    ]);

    const row = await fetchRow(slug, { listingType: type });

    expect((row?.previewPhotos ?? []).map((p) => p.listingId)).toEqual([ids[0]]);
  });
});

describe('previewPhotos respect media suppression', () => {
  it('shows only the retained photo of a suppressed-media listing', async () => {
    const { slug, ids } = await seedHood('retained', [
      { listedDaysAgo: 1, photos: 2, mediaDisplayAllowed: false, retained: true },
    ]);

    const row = await fetchRow(slug);

    expect(row?.previewPhotos).toEqual([
      { url: `https://cdn.example/e2e-preview/${ids[0]}-0.jpg`, listingId: ids[0] },
    ]);
  });

  it('shows no photo for a suppressed-media listing with no retained photo', async () => {
    const { slug } = await seedHood('noretained', [
      { listedDaysAgo: 1, photos: 2, mediaDisplayAllowed: false },
    ]);

    const row = await fetchRow(slug);

    expect(row?.previewPhotos).toBeUndefined();
  });
});

describe('previewPhotos are read live', () => {
  it('drops the photo of a listing that is removed or suppressed, and brings it back', async () => {
    const { slug, ids } = await seedHood('live', [{ listedDaysAgo: 1 }, { listedDaysAgo: 2 }]);
    const pool = getPool();
    const photoIds = async () =>
      ((await fetchRow(slug))?.previewPhotos ?? []).map((p) => p.listingId);

    expect(await photoIds()).toEqual([ids[0], ids[1]]);

    await pool.query('UPDATE listings SET deleted_at = now() WHERE id = $1', [ids[0]]);
    expect(await photoIds()).toEqual([ids[1]]);

    await pool.query('UPDATE listings SET deleted_at = NULL WHERE id = $1', [ids[0]]);
    await pool.query('UPDATE listings SET internet_display_allowed = false WHERE id = $1', [
      ids[1],
    ]);
    expect(await photoIds()).toEqual([ids[0]]);

    await pool.query('UPDATE listings SET internet_display_allowed = true WHERE id = $1', [ids[1]]);
    await pool.query(
      "UPDATE listings SET consumer_status = 'Sold', close_date = NULL WHERE id = $1",
      [ids[0]],
    );
    expect(await photoIds()).toEqual([ids[1]]);
  });
});
