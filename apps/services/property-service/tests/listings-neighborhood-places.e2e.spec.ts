import axios from 'axios';
import { neighborhoodsResponseSchema } from '@cribstop/property-contracts';
import { closePool, getPool } from '../src/db/pool';
import { assertFixturesEnabled } from './support/fixtures';

/**
 * #488. `GET /listings/neighborhoods?place=City,ST` against a REAL service and REAL database.
 *
 * Every seeded city name carries the run id, so no assertion depends on other rows in the table.
 */

const RUN = Date.now().toString(36);
const ALPHA = `E2E Alpha ${RUN}`;
const BETA = `E2E Beta ${RUN}`;
const SAME = `E2E Same ${RUN}`;

let seq = 0;

async function seedHood(city: string, state: string, hood: string, sale: number, rent = 0) {
  const pool = getPool();
  for (let i = 0; i < sale + rent; i += 1) {
    seq += 1;
    const key = `e2e-places-${RUN}-${seq}`;
    const property = await pool.query<{ id: string }>(
      `INSERT INTO properties (address_raw, street_line, city, state, zip5, address_key,
                               neighborhood, property_type, is_sample)
       VALUES ($1, $1, $2, $3, '21701', $4, $5, 'Single Family', true) RETURNING id`,
      [`${seq} Places Fixture St`, city, state, key, hood],
    );
    await pool.query(
      `INSERT INTO listings (property_id, title, offer_kind, status, source, list_price,
                             neighborhood, city, state, zip5, consumer_status, broker_name,
                             broker_phone, office_name, last_updated, listed_at,
                             media_display_allowed, is_sample)
       VALUES ($1, $2, $3, 'Active', 'internal', 400000, $4, $5, $6, '21701', 'Active',
               'Broker', '555-0100', 'Office', now(), now(), true, true)`,
      [
        property.rows[0]?.id,
        `E2E Fixture (Sample) ${key}`,
        i < sale ? 'sale' : 'rent',
        hood,
        city,
        state,
      ],
    );
  }
}

async function get(query: string): Promise<{ status: number; data: unknown }> {
  const response = await axios.get(`/listings/neighborhoods?${query}`, {
    validateStatus: () => true,
  });
  return { status: response.status, data: response.data };
}

async function rows(query: string) {
  const { status, data } = await get(`minCount=1&${query}`);
  expect(status).toBe(200);
  return neighborhoodsResponseSchema.parse(data);
}

const names = (body: { results: { name: string; state: string }[] }) =>
  body.results.map((r) => `${r.name}|${r.state}`).sort();

beforeAll(async () => {
  assertFixturesEnabled();
  await seedHood(ALPHA, 'MD', 'Hood One', 3);
  await seedHood(BETA, 'VA', 'Hood Two', 2, 1);
  await seedHood(SAME, 'MD', 'Hood Md', 2);
  await seedHood(SAME, 'DC', 'Hood Dc', 4);
});

afterAll(async () => {
  const pool = getPool();
  const cities = [ALPHA, BETA, SAME];
  await pool.query('DELETE FROM listings WHERE is_sample AND city = ANY($1)', [cities]);
  await pool.query('DELETE FROM properties WHERE is_sample AND city = ANY($1)', [cities]);
  await closePool();
});

describe('place list', () => {
  it('matches one place', async () => {
    const body = await rows(`place=${encodeURIComponent(`${ALPHA},MD`)}`);
    expect(names(body)).toEqual(['Hood One|MD']);
    expect(body.total).toBe(1);
  });

  it('matches several places across states in one request', async () => {
    const body = await rows(
      `place=${encodeURIComponent(`${ALPHA},MD`)}&place=${encodeURIComponent(`${BETA},VA`)}`,
    );
    expect(names(body)).toEqual(['Hood One|MD', 'Hood Two|VA']);
    expect(body.total).toBe(2);
  });

  it('matches only the listed state when a city name exists in two states', async () => {
    const body = await rows(`place=${encodeURIComponent(`${SAME},DC`)}`);
    expect(names(body)).toEqual(['Hood Dc|DC']);
  });

  it('matches case-insensitively', async () => {
    const body = await rows(`place=${encodeURIComponent(`${ALPHA.toUpperCase()}, md`)}`);
    expect(names(body)).toEqual(['Hood One|MD']);
  });

  it('applies listingType, minCount and limit across all places, with an unclamped total', async () => {
    const places = [ALPHA + ',MD', SAME + ',MD', SAME + ',DC'];
    const query = places.map((p) => `place=${encodeURIComponent(p)}`).join('&');

    const limited = await rows(`${query}&limit=2`);
    expect(limited.results).toHaveLength(2);
    expect(limited.total).toBe(3);
    // Row order stays count based: 4 (Dc), then 3 (One).
    expect(limited.results.map((r) => r.name)).toEqual(['Hood Dc', 'Hood One']);

    const floor = await get(`${query}&minCount=3`);
    expect(names(neighborhoodsResponseSchema.parse(floor.data))).toEqual([
      'Hood Dc|DC',
      'Hood One|MD',
    ]);

    const rentOnly = await rows(`place=${encodeURIComponent(`${BETA},VA`)}&listingType=rent`);
    expect(rentOnly.results[0]).toMatchObject({ total: 1, sale: 2, rent: 1 });
  });

  it('keeps city alone working', async () => {
    const body = await rows(`city=${encodeURIComponent(ALPHA)}`);
    expect(names(body)).toEqual(['Hood One|MD']);
  });
});

describe('place list rejections', () => {
  it('rejects 26 places', async () => {
    const query = Array.from({ length: 26 }, (_v, i) => `place=City${i},MD`).join('&');
    expect((await get(query)).status).toBe(400);
  });

  it.each(['Bethesda', ',MD', 'Bethesda,MDD', 'Bethesda,ZZ9'])('rejects %s', async (place) => {
    expect((await get(`place=${encodeURIComponent(place)}`)).status).toBe(400);
  });

  it('rejects a duplicate place', async () => {
    expect((await get('place=Bethesda,MD&place=BETHESDA,md')).status).toBe(400);
  });

  it.each(['city=Bethesda', 'state=MD'])('rejects place with %s and names both', async (other) => {
    const { status, data } = await get(`place=Bethesda,MD&${other}`);
    const name = other.split('=')[0] as string;
    expect(status).toBe(400);
    expect(JSON.stringify(data)).toContain(`place, ${name}`);
  });
});
