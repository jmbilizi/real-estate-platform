import axios from 'axios';
import {
  type ListingCardRow,
  listingDetailSchema,
  listingsEnvelopeSchema,
} from '@cribstop/property-contracts';
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
 * #717. The price change of a card and the price history of a detail page, against a REAL service
 * and a REAL database. Every price is a stored MLS price. The fixtures write them through
 * `upsertListing`, as the sync does.
 */

const OLD = '2026-09-18T00:00:00.000Z';
const NEW = '2026-10-03T00:00:00.000Z';
const CHANGED = '2026-10-02T12:00:00.000Z';

/** A record that ended: off the market, with the instant it ended. */
const ended = (listedAt: string, endedAt: string, listPrice: number, mlsNumber?: string) => ({
  listedAt,
  status: null,
  statusChangedAt: endedAt,
  listPrice,
  mlsNumber,
});

const HOMES: HomeInput[] = [
  { street: '1 Same Cut Ln', records: [{ listedAt: OLD, listPrice: 2297500, mlsNumber: 'VAC1' }] },
  { street: '2 Same Raise Ln', records: [{ listedAt: OLD, listPrice: 2000000 }] },
  {
    street: '3 Relist Cut Ln',
    records: [
      ended('2026-06-01T00:00:00.000Z', '2026-08-20T00:00:00.000Z', 2297500, 'VAR1'),
      { listedAt: '2026-09-01T00:00:00.000Z', listPrice: 2197500, mlsNumber: 'VAR2' },
    ],
  },
  {
    street: '4 Relist Raise Ln',
    records: [
      ended('2026-06-01T00:00:00.000Z', '2026-08-20T00:00:00.000Z', 2000000, 'VAS1'),
      { listedAt: '2026-09-01T00:00:00.000Z', listPrice: 2100000 },
    ],
  },
  { street: '5 Fresh Ln', records: [{ listedAt: OLD, listPrice: 450000 }] },
  {
    // The record ended exactly 60 days before the relist.
    street: '6 Window Edge Ln',
    records: [
      ended('2026-05-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z', 600000, 'VAW1'),
      { listedAt: '2026-08-30T00:00:00.000Z', listPrice: 575000 },
    ],
  },
  {
    // 61 days: no indicator.
    street: '7 Window Out Ln',
    records: [
      ended('2026-05-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z', 600000),
      { listedAt: '2026-08-31T00:00:00.000Z', listPrice: 575000 },
    ],
  },
  {
    // The winner and the older live record differ in price. The winner compares to the older one.
    street: '8 Winner Differs Ln',
    records: [
      { listedAt: OLD, listPrice: 2000000 },
      { listedAt: NEW, listPrice: 1900000 },
    ],
  },
  {
    street: '9 History Hidden Ln',
    records: [{ listedAt: OLD, listPrice: 800000, priceHistoryAllowed: false }],
  },
  {
    street: '10 Same Price Ln',
    records: [
      ended('2026-06-01T00:00:00.000Z', '2026-08-20T00:00:00.000Z', 700000),
      { listedAt: '2026-09-01T00:00:00.000Z', listPrice: 700000 },
    ],
  },
  {
    // A taken-down record of another office never supplies a price.
    street: '11 Other Office Ln',
    records: [
      {
        ...ended('2026-06-01T00:00:00.000Z', '2026-08-20T00:00:00.000Z', 900000),
        office: 'E2E Fixture Office B',
      },
      { listedAt: '2026-09-01T00:00:00.000Z', listPrice: 850000 },
    ],
  },
];

let seeded: Record<string, SeededHome>;
const pool = getPool();

const homeOf = (street: string): SeededHome => {
  const home = seeded[street];
  if (!home) {
    throw new Error(`No seeded home: ${street}`);
  }
  return home;
};

async function cardOf(street: string): Promise<ListingCardRow> {
  const response = await axios.get('/listings', {
    params: {
      city: COLLAPSE_CITY,
      state: COLLAPSE_STATE,
      status: 'Active,Coming Soon,Pending',
      pageSize: 100,
    },
  });
  const { results } = listingsEnvelopeSchema.parse(response.data);
  const cards = results.filter((card) => homeOf(street).ids.includes(card.id));
  expect(cards).toHaveLength(1);
  return cards[0] as ListingCardRow;
}

beforeAll(async () => {
  seeded = await seedHomes(pool, HOMES);
  await repriceRecord(pool, homeOf('1 Same Cut Ln'), 0, 2197500, CHANGED);
  await repriceRecord(pool, homeOf('2 Same Raise Ln'), 0, 2100000, CHANGED);
  await repriceRecord(pool, homeOf('9 History Hidden Ln'), 0, 750000, CHANGED);
});

afterAll(async () => {
  await removeCollapseFixtures(pool);
  await closePool();
});

describe('price change on the card (#717)', () => {
  it('same key, cut: the earlier price of the key and the change instant', async () => {
    const card = await cardOf('1 Same Cut Ln');
    expect(card.price).toBe(2197500);
    expect(card.previousPrice).toBe(2297500);
    expect(card.priceChangedAt).toBe(CHANGED);
  });

  it('same key, increase', async () => {
    const card = await cardOf('2 Same Raise Ln');
    expect([card.previousPrice, card.price]).toEqual([2000000, 2100000]);
  });

  it('relist, cut: the last price of the earlier key, dated at the relist', async () => {
    const card = await cardOf('3 Relist Cut Ln');
    expect([card.previousPrice, card.price]).toEqual([2297500, 2197500]);
    expect(card.priceChangedAt).toBe('2026-09-01T00:00:00.000Z');
  });

  it('relist, increase', async () => {
    const card = await cardOf('4 Relist Raise Ln');
    expect([card.previousPrice, card.price]).toEqual([2000000, 2100000]);
  });

  it('shows nothing when no earlier price exists', async () => {
    const card = await cardOf('5 Fresh Ln');
    expect([card.previousPrice, card.priceChangedAt]).toEqual([null, null]);
  });

  it('accepts an earlier record that ended 60 days before the relist', async () => {
    expect((await cardOf('6 Window Edge Ln')).previousPrice).toBe(600000);
  });

  it('ignores an earlier record that ended 61 days before the relist', async () => {
    expect((await cardOf('7 Window Out Ln')).previousPrice).toBeNull();
  });

  it('compares the winner to the older live record of the home', async () => {
    const card = await cardOf('8 Winner Differs Ln');
    expect(card.id).toBe(homeOf('8 Winner Differs Ln').ids[1]);
    expect([card.previousPrice, card.price]).toEqual([2000000, 1900000]);
  });

  it('shows nothing when the seller withholds the price history', async () => {
    const card = await cardOf('9 History Hidden Ln');
    expect([card.previousPrice, card.priceChangedAt]).toEqual([null, null]);
  });

  it('shows nothing when the relist keeps the price', async () => {
    expect((await cardOf('10 Same Price Ln')).previousPrice).toBeNull();
  });

  it('ignores an ended record of another office', async () => {
    expect((await cardOf('11 Other Office Ln')).previousPrice).toBeNull();
  });
});

describe('price history on the detail page (#717)', () => {
  async function historyOf(street: string, index: number) {
    const response = await axios.get(`/listings/${homeOf(street).ids[index]}`);
    return listingDetailSchema.parse(response.data).listing;
  }

  it('lists the stored prices of one key, oldest first, with the change', async () => {
    const listing = await historyOf('1 Same Cut Ln', 0);
    expect(listing.priceHistory.map((entry) => [entry.price, entry.change])).toEqual([
      [2297500, null],
      [2197500, -100000],
    ]);
    expect(listing.priceHistory[0]?.mlsNumber).toBe('VAC1');
    expect(listing.previousPrice).toBe(2297500);
  });

  it('adds the prices of the relist predecessor', async () => {
    const listing = await historyOf('3 Relist Cut Ln', 1);
    expect(
      listing.priceHistory.map((entry) => [entry.price, entry.change, entry.mlsNumber]),
    ).toEqual([
      [2297500, null, 'VAR1'],
      [2197500, -100000, 'VAR2'],
    ]);
  });

  it('is empty when the seller withholds the price history', async () => {
    const listing = await historyOf('9 History Hidden Ln', 0);
    expect(listing.priceHistory).toEqual([]);
    expect(listing.previousPrice).toBeNull();
  });
});

describe('migration 056 backfill (#717)', () => {
  it('restates an earlier price from the stored listed events, and adds no price', async () => {
    const id = homeOf('1 Same Cut Ln').ids[0];
    await pool.query(
      "DELETE FROM listing_events WHERE listing_id = $1 AND event_type = 'price_change'",
      [id],
    );
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const migration = require('../migrations/1785801600056_backfill-price-change-events');
    const statements: string[] = [];
    migration.up({ sql: (text: string) => statements.push(text) });
    await pool.query(statements.join(';'));

    const { rows } = await pool.query(
      `SELECT old_price::float8 AS old_price, new_price::float8 AS new_price
         FROM listing_events WHERE listing_id = $1 AND event_type = 'price_change'`,
      [id],
    );
    expect(rows).toEqual([{ old_price: 2297500, new_price: 2197500 }]);
    expect((await cardOf('1 Same Cut Ln')).previousPrice).toBe(2297500);
  });
});
