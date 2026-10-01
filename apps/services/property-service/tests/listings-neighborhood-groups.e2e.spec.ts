import axios from 'axios';
import {
  listingsEnvelopeSchema,
  neighborhoodKey,
  neighborhoodsResponseSchema,
} from '@cribstop/property-contracts';
import { closePool, getPool } from '../src/db/pool';
import { assertFixturesEnabled } from './support/fixtures';

/**
 * #501. `GET /listings/neighborhoods` groups, keys, centroid and bounds against a REAL service and
 * REAL database. Every city name carries the run id, so no assertion depends on other rows.
 */

const RUN = Date.now().toString(36);
const CITY_A = `E2E Groups A ${RUN}`;
const CITY_B = `E2E Groups B ${RUN}`;
const CITY_C = `E2E Groups C ${RUN}`;
const CITY_D = `E2E Groups D ${RUN}`;
const SAME_NAME = 'Shared Hood';

let seq = 0;

interface Seed {
  city: string;
  hood: string;
  lat: number | null;
  lng: number | null;
  /** Defaults to true. A false value withholds the address, so the view masks the point. */
  addressAllowed?: boolean;
  beds?: number;
}

async function seed(rowsToSeed: Seed[]) {
  const pool = getPool();
  for (const row of rowsToSeed) {
    seq += 1;
    const key = `e2e-groups-${RUN}-${seq}`;
    const property = await pool.query<{ id: string }>(
      `INSERT INTO properties (address_raw, street_line, city, state, zip5, address_key,
                               neighborhood, latitude, longitude, beds, property_type, is_sample)
       VALUES ($1, $1, $2, 'MD', '21701', $3, $4, $5, $6, $7, 'Single Family', true) RETURNING id`,
      [`${seq} Groups Fixture St`, row.city, key, row.hood, row.lat, row.lng, row.beds ?? 3],
    );
    await pool.query(
      `INSERT INTO listings (property_id, title, offer_kind, status, source, list_price,
                             neighborhood, city, state, zip5, latitude, longitude, beds,
                             consumer_status, broker_name, broker_phone, office_name,
                             last_updated, listed_at, media_display_allowed,
                             address_display_allowed, is_sample)
       VALUES ($1, $2, 'sale', 'Active', 'internal', 400000, $3, $4, 'MD', '21701', $5, $6, $7,
               'Active', 'Broker', '555-0100', 'Office', now(), now(), true, $8, true)`,
      [
        property.rows[0]?.id,
        `E2E Fixture (Sample) ${key}`,
        row.hood,
        row.city,
        row.lat,
        row.lng,
        row.beds ?? 3,
        row.addressAllowed ?? true,
      ],
    );
  }
}

async function groups(query: string) {
  const response = await axios.get(`/listings/neighborhoods?minCount=1&${query}`, {
    validateStatus: () => true,
  });
  expect(response.status).toBe(200);
  return neighborhoodsResponseSchema.parse(response.data);
}

const place = (city: string) => `city=${encodeURIComponent(city)}&state=MD`;

beforeAll(async () => {
  assertFixturesEnabled();
  await seed([
    // CITY_A "Shared Hood": three allowed points (median lat 10.1) and one masked point at lat 50.
    { city: CITY_A, hood: SAME_NAME, lat: 10, lng: -80 },
    { city: CITY_A, hood: SAME_NAME, lat: 10.1, lng: -79.9, beds: 4 },
    { city: CITY_A, hood: SAME_NAME, lat: 10.2, lng: -79.8 },
    { city: CITY_A, hood: SAME_NAME, lat: 50, lng: -10, addressAllowed: false },
    // CITY_B holds the same neighborhood name at another place.
    { city: CITY_B, hood: SAME_NAME, lat: 30, lng: -70 },
    // CITY_C: one group whose only listing is masked, and one group of three.
    { city: CITY_C, hood: 'Masked Only', lat: 40, lng: -60, addressAllowed: false },
    { city: CITY_C, hood: 'Zed Hood', lat: 20, lng: -50 },
    { city: CITY_C, hood: 'Zed Hood', lat: 21, lng: -50 },
    { city: CITY_C, hood: 'Zed Hood', lat: 22, lng: -50 },
    // CITY_D (#512): four real points, one 0,0 point, one 0-longitude point and one far outlier.
    { city: CITY_D, hood: 'Stray Hood', lat: 38.9, lng: -77.03 },
    { city: CITY_D, hood: 'Stray Hood', lat: 38.91, lng: -77.02 },
    { city: CITY_D, hood: 'Stray Hood', lat: 38.92, lng: -77.01 },
    { city: CITY_D, hood: 'Stray Hood', lat: 38.93, lng: -77 },
    { city: CITY_D, hood: 'Stray Hood', lat: 0, lng: 0 },
    { city: CITY_D, hood: 'Stray Hood', lat: 38.95, lng: 0 },
    { city: CITY_D, hood: 'Stray Hood', lat: 39.27, lng: -77.01 },
  ]);
});

afterAll(async () => {
  const pool = getPool();
  const cities = [CITY_A, CITY_B, CITY_C, CITY_D];
  await pool.query('DELETE FROM listings WHERE is_sample AND city = ANY($1)', [cities]);
  await pool.query('DELETE FROM properties WHERE is_sample AND city = ANY($1)', [cities]);
  await closePool();
});

describe('key (#501)', () => {
  it('keeps one neighborhood name in two cities apart', async () => {
    const body = await groups(`${place(CITY_A)}`);
    const other = await groups(`${place(CITY_B)}`);
    expect(body.results).toHaveLength(1);
    expect(other.results).toHaveLength(1);
    expect(body.results[0]?.slug).toBe(other.results[0]?.slug);
    expect(body.results[0]?.key).toBe(
      neighborhoodKey({ state: 'MD', city: CITY_A, name: SAME_NAME }),
    );
    expect(body.results[0]?.key).not.toBe(other.results[0]?.key);
  });
});

describe('centroid and bounds (#501)', () => {
  it('never lets a masked address move the centroid or the bounds', async () => {
    const [row] = (await groups(place(CITY_A))).results;
    expect(row?.total).toBe(4);
    expect(row?.centroid).toEqual({ lat: 10.1, lng: -79.9 });
    expect(row?.bounds).toEqual({ south: 10, west: -80, north: 10.2, east: -79.8 });
  });

  it('ignores 0 coordinates and one far outlier in the bounds (#512)', async () => {
    const [row] = (await groups(place(CITY_D))).results;
    expect(row?.total).toBe(7);
    expect(row?.bounds).toEqual({ south: 38.9, west: -77.03, north: 38.93, east: -77 });
    expect(row?.centroid?.lat).toBeCloseTo(38.92, 3);
    expect(row?.centroid?.lng).toBeCloseTo(-77.01, 3);
  });

  it('answers null centroid and bounds for a group with no allowed listing', async () => {
    const body = await groups(place(CITY_C));
    const masked = body.results.find((r) => r.name === 'Masked Only');
    expect(masked?.total).toBe(1);
    expect(masked?.centroid).toBeNull();
    expect(masked?.bounds).toBeNull();
  });
});

describe('search filters (#501)', () => {
  it('follows the search filter set on the view path', async () => {
    const body = await groups(`${place(CITY_A)}&beds=4`);
    expect(body.results).toHaveLength(1);
    expect(body.results[0]?.total).toBe(1);
    expect(body.results[0]?.centroid).toEqual({ lat: 10.1, lng: -79.9 });
  });

  it('returns the neighborhood set of the matching GET /listings search', async () => {
    const listings = await axios.get(`/listings?${place(CITY_C)}&pageSize=100&minPrice=300000`, {
      validateStatus: () => true,
    });
    const envelope = listingsEnvelopeSchema.parse(listings.data);
    const fromSearch = new Set(envelope.results.map((r) => r.neighborhood?.toLowerCase()));
    const body = await groups(`${place(CITY_C)}&minPrice=300000`);
    expect(new Set(body.results.map((r) => r.name.toLowerCase()))).toEqual(fromSearch);
  });

  it('filters by neighborhood scoped to a city', async () => {
    const body = await groups(`neighborhood=${encodeURIComponent(SAME_NAME)}&${place(CITY_B)}`);
    expect(body.results.map((r) => r.key)).toEqual([
      neighborhoodKey({ state: 'MD', city: CITY_B, name: SAME_NAME }),
    ]);
  });
});

describe('order and paging (#501)', () => {
  it('orders by count, then name, and pages with an exact total', async () => {
    const first = await groups(`${place(CITY_C)}&limit=1`);
    expect(first.total).toBe(2);
    expect(first.results.map((r) => r.name)).toEqual(['Zed Hood']);
    const second = await groups(`${place(CITY_C)}&limit=1&offset=1`);
    expect(second.results.map((r) => r.name)).toEqual(['Masked Only']);
    expect(second.total).toBe(2);
  });

  it('keeps the exact total for an offset past the end', async () => {
    const body = await groups(`${place(CITY_C)}&offset=50`);
    expect(body.results).toEqual([]);
    expect(body.total).toBe(2);
  });

  it('orders by name when asked', async () => {
    const body = await groups(`${place(CITY_C)}&order=name`);
    expect(body.results.map((r) => r.name)).toEqual(['Masked Only', 'Zed Hood']);
  });
});
