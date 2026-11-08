import axios from 'axios';
import { cityStatsSchema } from '@cribstop/property-contracts';
import { closePool, getPool } from '../src/db/pool';
import {
  COLLAPSE_CITY,
  COLLAPSE_STATE,
  type HomeInput,
  removeCollapseFixtures,
  seedHomes,
  setRecordFacts,
} from './support/collapse-fixtures';

/**
 * #985. City medians against a REAL service and a REAL database. The fixtures are written as
 * samples, as every fixture is. The homes that must count are then switched to non-sample with
 * one UPDATE, because the endpoint excludes sample rows. `removeCollapseFixtures` deletes all of
 * them by community.
 */

const SMALL_CITY = 'Tinyville';
const NEWEST = '2026-10-05T00:00:00.000Z';
const FEED = '2026-10-01T00:00:00.000Z';
const AFTER = '2026-12-31T00:00:00.000Z';

const home = (street: string, record: HomeInput['records'][number], city?: string): HomeInput => ({
  street,
  zip: '00001',
  ...(city === undefined ? {} : { city }),
  records: [{ lastUpdated: FEED, ...record }],
});

const HOMES: HomeInput[] = [
  // Five complete rows. Price per sq ft is 300, 400, 500, 600 and 700.
  home('1 A St', { listPrice: 300000, daysOnMarket: 10 }),
  home('2 A St', { listPrice: 400000, daysOnMarket: 20 }),
  home('3 A St', { listPrice: 500000, daysOnMarket: 30 }),
  home('4 A St', { listPrice: 600000, daysOnMarket: 40 }),
  home('5 A St', { listPrice: 700000, daysOnMarket: 50, lastUpdated: NEWEST }),
  // Price withheld: a huge price that must stay out of both price medians. Days on market counts.
  home('6 A St', { listPrice: 9000000, daysOnMarket: 30, priceAllowed: false }),
  // Days on market withheld: a huge value that must stay out. The price counts.
  home('7 A St', { listPrice: 500000, daysOnMarket: 9999 }),
  // No square feet: counts for price and days on market, not for price per sq ft.
  home('8 A St', { listPrice: 800000, daysOnMarket: 30 }),
  // Excluded rows. Each has a price that would move the median, and a date after the feed.
  home('9 A St', { listPrice: 1, daysOnMarket: 1, lastUpdated: AFTER }),
  home('10 A St', { listPrice: 1, daysOnMarket: 1, lastUpdated: AFTER }),
  home('11 A St', { listPrice: 1, daysOnMarket: 1, lastUpdated: AFTER }),
  // One rental. Fewer than 5 inputs.
  home('12 A St', { listPrice: 2000, daysOnMarket: 3, offerKind: 'rent' }),
  // A second city with 4 complete rows.
  ...[1, 2, 3, 4].map((n) =>
    home(`${n} B St`, { listPrice: 100000 * n, daysOnMarket: n }, SMALL_CITY),
  ),
];

const pool = getPool();

async function cityStats(params: Record<string, string> = {}) {
  const response = await axios.get('/listings/city-stats', {
    params: { city: COLLAPSE_CITY, state: COLLAPSE_STATE, ...params },
  });
  return cityStatsSchema.parse(response.data);
}

async function update(sql: string, values: unknown[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(sql, values);
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  const seeded = await seedHomes(pool, HOMES);
  const id = (street: string): string => seeded[street]?.ids[0] as string;
  const property = (street: string): string => seeded[street]?.propertyId as string;

  for (const [street, facts] of Object.entries({
    '1 A St': 1000,
    '2 A St': 1000,
    '3 A St': 1000,
    '4 A St': 1000,
    '5 A St': 1000,
    '7 A St': 1000,
  })) {
    await setRecordFacts(pool, id(street), { livingSqft: facts });
  }
  await update('UPDATE listings SET living_sqft = NULL WHERE id = $1', [id('8 A St')]);
  await update('UPDATE properties SET living_sqft = NULL WHERE id = $1', [property('8 A St')]);
  await update('UPDATE listings SET days_on_market_display_allowed = false WHERE id = $1', [
    id('7 A St'),
  ]);
  await update("UPDATE listings SET consumer_status = 'Pending' WHERE id = $1", [id('10 A St')]);
  await update(
    "UPDATE listings SET consumer_status = 'Sold', close_date = DATE '2026-09-01' WHERE id = $1",
    [id('11 A St')],
  );
  // Every home but the sample one (9 A St) becomes a non-sample record.
  const counted = Object.keys(seeded).filter((street) => street !== '9 A St');
  const propertyIds = counted.map(property);
  await update('UPDATE listings SET is_sample = false WHERE property_id = ANY($1)', [propertyIds]);
  await update('UPDATE properties SET is_sample = false WHERE id = ANY($1)', [propertyIds]);
});

afterAll(async () => {
  await removeCollapseFixtures(pool);
  await closePool();
});

describe('GET /listings/city-stats (#985)', () => {
  it('computes each median from the rows that carry its inputs', async () => {
    const stats = await cityStats();
    // 1-5, 6 (price withheld) and 8 (no area) and 7 (days withheld) count. 9 is a sample, 10 is
    // pending, 11 is sold and 12 is a rental.
    expect(stats.listingCount).toBe(8);
    expect(stats.medianListPrice).toEqual({ value: 500000, inputCount: 7 });
    expect(stats.medianDaysOnMarket).toEqual({ value: 30, inputCount: 7 });
    expect(stats.medianPricePerSqft).toEqual({ value: 500, inputCount: 6 });
  });

  it('dates the statistics by the newest counted feed update', async () => {
    expect((await cityStats()).dataUpdatedAt).toBe(NEWEST);
  });

  it('matches the city and the state without regard to case', async () => {
    const stats = await cityStats({ city: COLLAPSE_CITY.toUpperCase(), state: 'zz' });
    expect(stats.listingCount).toBe(8);
  });

  it('returns null and the input count for a statistic with fewer than 5 inputs', async () => {
    const stats = await cityStats({ city: SMALL_CITY });
    expect(stats.listingCount).toBe(4);
    expect(stats.medianListPrice).toEqual({ value: null, inputCount: 4 });
    expect(stats.medianDaysOnMarket).toEqual({ value: null, inputCount: 4 });
    expect(stats.medianPricePerSqft).toEqual({ value: null, inputCount: 4 });
  });

  it('keeps rent out of the sale statistics and answers rent on request', async () => {
    const rent = await cityStats({ listingType: 'rent' });
    expect(rent.listingCount).toBe(1);
    expect(rent.medianListPrice).toEqual({ value: null, inputCount: 1 });
  });

  it('answers a city with no listing with zero counts and no date', async () => {
    const stats = await cityStats({ city: 'No Such City' });
    expect(stats.listingCount).toBe(0);
    expect(stats.medianListPrice).toEqual({ value: null, inputCount: 0 });
    expect(stats.dataUpdatedAt).toBeNull();
  });

  it('rejects a request with no city, and an unknown parameter', async () => {
    await expect(
      axios.get('/listings/city-stats', { params: { state: 'ZZ' } }),
    ).rejects.toMatchObject({ response: { status: 400 } });
    await expect(
      axios.get('/listings/city-stats', {
        params: { city: COLLAPSE_CITY, state: 'ZZ', fields: 'price' },
      }),
    ).rejects.toMatchObject({ response: { status: 400 } });
  });

  it('returns no listing row and no address', async () => {
    const response = await axios.get('/listings/city-stats', {
      params: { city: COLLAPSE_CITY, state: COLLAPSE_STATE },
    });
    expect(Object.keys(response.data).sort()).toEqual([
      'dataUpdatedAt',
      'listingCount',
      'medianDaysOnMarket',
      'medianListPrice',
      'medianPricePerSqft',
    ]);
  });
});
