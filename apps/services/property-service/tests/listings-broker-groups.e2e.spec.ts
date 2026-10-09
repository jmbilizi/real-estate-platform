import axios from 'axios';
import {
  type BrokersResponse,
  brokersResponseSchema,
  listingsEnvelopeSchema,
} from '@cribstop/property-contracts';
import { closePool, getPool } from '../src/db/pool';
import {
  COLLAPSE_CITY,
  COLLAPSE_STATE,
  type HomeInput,
  removeCollapseFixtures,
  seedHomes,
} from './support/collapse-fixtures';

/**
 * #722. Broker groups against a REAL service and a REAL database. The group key is the office key.
 * The counts must equal the cards of the same search.
 */

const OLD = '2026-09-18T00:00:00.000Z';
const NEW = '2026-10-03T00:00:00.000Z';

const HOMES: HomeInput[] = [
  // One office, two name spellings. The newer listing carries the name the group shows.
  {
    street: '1 Acme Rd',
    records: [{ officeKey: '1001', office: 'Acme Realty', modifiedAt: '2026-09-20T00:00:00.000Z' }],
  },
  {
    street: '2 Acme Rd',
    records: [{ officeKey: '1001', office: 'Acme Realty LLC', modifiedAt: NEW }],
  },
  // A relist inside one office is one card.
  {
    street: '3 Acme Rd',
    records: [
      { officeKey: '1001', office: 'Acme Realty LLC', listedAt: OLD, modifiedAt: OLD },
      { officeKey: '1001', office: 'Acme Realty LLC', listedAt: NEW, modifiedAt: NEW },
    ],
  },
  // Two offices that share one name stay two groups.
  { street: '1 Twin Rd', records: [{ officeKey: '2001', office: 'Twin Brokerage' }] },
  { street: '2 Twin Rd', records: [{ officeKey: '2002', office: 'Twin Brokerage' }] },
  { street: '3 Twin Rd', records: [{ officeKey: '2002', office: 'Twin Brokerage' }] },
  // Real Broker, LLC is one office like any other. It has no special position.
  { street: '1 Real Rd', records: [{ officeKey: '3001', office: 'Real Broker, LLC' }] },
  // No office key: the listings still count, in one group.
  { street: '1 Blank Rd', records: [{ officeKey: null, office: 'Keyless One' }] },
  { street: '2 Blank Rd', records: [{ officeKey: null, office: 'Keyless Two' }] },
];

const SEARCH = { city: COLLAPSE_CITY, state: COLLAPSE_STATE, status: 'Active,Coming Soon,Pending' };
const pool = getPool();

async function brokers(params: Record<string, unknown> = {}): Promise<BrokersResponse> {
  const response = await axios.get('/listings/brokers', { params: { ...SEARCH, ...params } });
  return brokersResponseSchema.parse(response.data);
}

async function searchTotal(params: Record<string, unknown> = {}): Promise<number> {
  const response = await axios.get('/listings', { params: { ...SEARCH, pageSize: 1, ...params } });
  return listingsEnvelopeSchema.parse(response.data).total;
}

const sum = (response: BrokersResponse): number =>
  response.groups.reduce((total, group) => total + group.count, 0);

beforeAll(async () => {
  await seedHomes(pool, HOMES);
});

afterAll(async () => {
  await removeCollapseFixtures(pool);
  await closePool();
});

describe('GET /listings/brokers (#722)', () => {
  it('groups by office key, names a group by its most recently updated listing', async () => {
    const response = await brokers();
    expect(response.groups).toEqual([
      { key: '1001', name: 'Acme Realty LLC', count: 3 },
      { key: '2002', name: 'Twin Brokerage', count: 2 },
      { key: 'unlisted', name: 'Other / unlisted', count: 2 },
      { key: '2001', name: 'Twin Brokerage', count: 1 },
      { key: '3001', name: 'Real Broker, LLC', count: 1 },
    ]);
    expect(response.total).toBe(5);
  });

  it('adds the group counts up to the search total, on the direct and the view source', async () => {
    const direct = await brokers();
    expect(sum(direct)).toBe(await searchTotal());
    expect(direct.listingTotal).toBe(await searchTotal());

    const view = await brokers({ beds: 1 });
    expect(sum(view)).toBe(await searchTotal({ beds: 1 }));
    expect(view.groups).toEqual(direct.groups);
  });

  it('orders by name for order=name, ties by key, and gives Real Broker no special place', async () => {
    const byName = await brokers({ order: 'name' });
    expect(byName.groups.map((g) => g.key)).toEqual(['1001', 'unlisted', '3001', '2001', '2002']);
    expect(byName.groups.map((g) => g.name)).toEqual([
      'Acme Realty LLC',
      'Other / unlisted',
      'Real Broker, LLC',
      'Twin Brokerage',
      'Twin Brokerage',
    ]);
  });

  it('pages with limit and offset, and keeps the exact totals', async () => {
    const page = await brokers({ limit: 2, offset: 2 });
    expect(page.groups.map((g) => g.key)).toEqual(['unlisted', '2001']);
    expect(page.total).toBe(5);
    expect(page.listingTotal).toBe(9);
  });

  it('opens one office with the officeKey filter, and the unlisted group with `unlisted`', async () => {
    const all = await brokers();
    for (const group of all.groups) {
      expect(await searchTotal({ officeKey: group.key })).toBe(group.count);
    }
    expect(await searchTotal({ officeKey: '9999999' })).toBe(0);
  });

  it('answers 400 for an office key that is not digits or `unlisted`', async () => {
    await expect(
      axios.get('/listings', { params: { officeKey: 'Real Broker' } }),
    ).rejects.toMatchObject({ response: { status: 400 } });
  });
});
