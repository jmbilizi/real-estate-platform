import axios from 'axios';
import {
  type BrokersResponse,
  brokersResponseSchema,
  listingsEnvelopeSchema,
} from '@cribstop/property-contracts';
import { closePool, getPool } from '../src/db/pool';
import {
  addPhoto,
  COLLAPSE_CITY,
  COLLAPSE_STATE,
  type HomeInput,
  photoUrlOf,
  removeCollapseFixtures,
  seedHomes,
  suppressMedia,
} from './support/collapse-fixtures';

/**
 * #722. Broker groups against a REAL service and a REAL database. The group key is the office key.
 * The counts must equal the cards of the same search.
 */

const OLD = '2026-09-18T00:00:00.000Z';
const NEW = '2026-10-03T00:00:00.000Z';
const ZIP_CITY = 'Zipville';
const ZIP = '00002';

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
  // #759. A second city and ZIP, so the ZIP-scoped search reads these four homes and no other.
  {
    street: '1 Zip Rd',
    city: ZIP_CITY,
    zip: ZIP,
    records: [{ officeKey: '4001', office: 'Zip A' }],
  },
  {
    street: '2 Zip Rd',
    city: ZIP_CITY,
    zip: ZIP,
    records: [{ officeKey: '4001', office: 'Zip A' }],
  },
  {
    street: '3 Zip Rd',
    city: ZIP_CITY,
    zip: ZIP,
    records: [{ officeKey: '4002', office: 'Zip B' }],
  },
  { street: '4 Zip Rd', city: ZIP_CITY, zip: ZIP, records: [{ officeKey: null, office: 'Zip C' }] },
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

const ids = { real: '', blank: '', twin: '', zipB: '' };

beforeAll(async () => {
  const seeded = await seedHomes(pool, HOMES);
  const id = (street: string): string => seeded[street]?.ids[0] as string;
  ids.real = id('1 Real Rd');
  ids.blank = id('1 Blank Rd');
  ids.twin = id('2 Twin Rd');
  ids.zipB = id('3 Zip Rd');
  for (const record of [ids.real, ids.blank, ids.twin, ids.zipB]) await addPhoto(pool, record);
  await suppressMedia(pool, ids.twin);
});

afterAll(async () => {
  await removeCollapseFixtures(pool);
  await closePool();
});

describe('GET /listings/brokers (#722)', () => {
  it('groups by office key, names a group by its most recently updated listing', async () => {
    const response = await brokers();
    expect(response.groups.map(({ key, name, count }) => ({ key, name, count }))).toEqual([
      { key: '1001', name: 'Acme Realty LLC', count: 3 },
      { key: '2002', name: 'Twin Brokerage', count: 2 },
      { key: 'unlisted', name: 'Other / unlisted', count: 2 },
      { key: '2001', name: 'Twin Brokerage', count: 1 },
      { key: '3001', name: 'Real Broker, LLC', count: 1 },
    ]);
    expect(response.total).toBe(5);
  });

  it('shows the same primary photos as a neighborhood row, with media suppression applied (#722)', async () => {
    const byKey = new Map((await brokers()).groups.map((g) => [g.key, g]));
    expect(byKey.get('3001')?.previewPhotos).toEqual([
      { url: photoUrlOf(ids.real), listingId: ids.real },
    ]);
    expect(byKey.get('unlisted')?.previewPhotos).toEqual([
      { url: photoUrlOf(ids.blank), listingId: ids.blank },
    ]);
    // `2 Twin Rd` has suppressed media. The group has no photo, and the field is absent.
    expect(byKey.get('2002')).not.toHaveProperty('previewPhotos');
    expect(byKey.get('1001')).not.toHaveProperty('previewPhotos');
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

  it('groups a ZIP search by office: the counts add up and each group opens its cards (#759)', async () => {
    const zip = { city: undefined, state: undefined, zip: ZIP };
    const response = await brokers(zip);
    expect(response.groups.map(({ key, name, count }) => ({ key, name, count }))).toEqual([
      { key: '4001', name: 'Zip A', count: 2 },
      { key: '4002', name: 'Zip B', count: 1 },
      { key: 'unlisted', name: 'Other / unlisted', count: 1 },
    ]);
    expect(response.total).toBe(3);
    expect(response.listingTotal).toBe(4);
    expect(sum(response)).toBe(await searchTotal(zip));
    for (const group of response.groups) {
      expect(await searchTotal({ ...zip, officeKey: group.key })).toBe(group.count);
    }
    // The photo lookup reads the same filtered rows as the counts.
    const byKey = new Map(response.groups.map((g) => [g.key, g]));
    expect(byKey.get('4002')?.previewPhotos).toEqual([
      { url: photoUrlOf(ids.zipB), listingId: ids.zipB },
    ]);
    expect(byKey.get('4001')).not.toHaveProperty('previewPhotos');
  });

  it('answers 400 for an office key that is not digits or `unlisted`', async () => {
    await expect(
      axios.get('/listings', { params: { officeKey: 'Real Broker' } }),
    ).rejects.toMatchObject({ response: { status: 400 } });
  });
});
