import axios from 'axios';
import { listingsEnvelopeSchema, zipsResponseSchema } from '@cribstop/property-contracts';
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
 * #722. ZIP groups against a REAL service and a REAL database. The homes sit in a city that no
 * other fixture uses. The group counts must equal the cards of the same search, because both read
 * one filter set and the #716 collapse.
 */

const OLD = '2026-09-18T00:00:00.000Z';
const NEW = '2026-10-03T00:00:00.000Z';

const HOMES: HomeInput[] = [
  // A relist of one home: two records, one card.
  { street: '1 Alpha Rd', zip: '00001', records: [{ listedAt: OLD }, { listedAt: NEW }] },
  { street: '2 Alpha Rd', zip: '00001', records: [{ listedAt: OLD }] },
  { street: '3 Alpha Rd', zip: '00001', records: [{ listedAt: OLD }] },
  { street: '1 Beta Rd', zip: '00002', records: [{ listedAt: OLD }] },
  { street: '2 Beta Rd', zip: '00002', records: [{ listedAt: OLD }] },
  // A ZIP+4 from the feed joins the five-digit group.
  { street: '1 Gamma Rd', zip: '00003-1234', records: [{ listedAt: OLD }] },
  { street: '2 Gamma Rd', zip: '00003', records: [{ listedAt: OLD, offerKind: 'rent' }] },
];

const SEARCH = { city: COLLAPSE_CITY, state: COLLAPSE_STATE, status: 'Active,Coming Soon,Pending' };
const pool = getPool();

async function zips(params: Record<string, unknown> = {}) {
  const response = await axios.get('/listings/zips', { params: { ...SEARCH, ...params } });
  return zipsResponseSchema.parse(response.data);
}

async function searchTotal(params: Record<string, unknown> = {}): Promise<number> {
  const response = await axios.get('/listings', { params: { ...SEARCH, pageSize: 1, ...params } });
  return listingsEnvelopeSchema.parse(response.data).total;
}

const ids = { relistWinner: '', shown: '', suppressed: '' };

beforeAll(async () => {
  const seeded = await seedHomes(pool, HOMES);
  const id = (street: string, index: number): string => seeded[street]?.ids[index] as string;
  ids.relistWinner = id('1 Alpha Rd', 1);
  ids.shown = id('2 Alpha Rd', 0);
  ids.suppressed = id('3 Alpha Rd', 0);
  // The older relist record has a photo too. The collapse hides it, so it must not show.
  for (const record of [id('1 Alpha Rd', 0), ids.relistWinner, ids.shown, ids.suppressed]) {
    await addPhoto(pool, record);
  }
  await suppressMedia(pool, ids.suppressed);
});

afterAll(async () => {
  await removeCollapseFixtures(pool);
  await closePool();
});

describe('GET /listings/zips (#722)', () => {
  it('counts the cards of each ZIP, ordered by count and then by key', async () => {
    const response = await zips();
    expect(response.groups.map(({ key, count }) => ({ key, count }))).toEqual([
      { key: '00001', count: 3 },
      { key: '00002', count: 2 },
      { key: '00003', count: 2 },
    ]);
    expect(response.total).toBe(3);
  });

  it('shows the primary photo of each card of the group, newest listed first (#722)', async () => {
    const group = (await zips()).groups.find((g) => g.key === '00001');
    // The relist's newest record wins the card. Its older record, and the home with suppressed
    // media, add no photo.
    expect(group?.previewPhotos).toEqual([
      { url: photoUrlOf(ids.relistWinner), listingId: ids.relistWinner },
      { url: photoUrlOf(ids.shown), listingId: ids.shown },
    ]);
    const bare = (await zips()).groups.find((g) => g.key === '00002');
    expect(bare).not.toHaveProperty('previewPhotos');
  });

  it('adds the group counts up to the search total, on the direct and the view source', async () => {
    const direct = await zips();
    expect(direct.groups.reduce((sum, g) => sum + g.count, 0)).toBe(await searchTotal());
    expect(direct.listingTotal).toBe(await searchTotal());

    // `beds` takes the view source. Every fixture home has 3 beds.
    const view = await zips({ beds: 1 });
    expect(view.groups.reduce((sum, g) => sum + g.count, 0)).toBe(await searchTotal({ beds: 1 }));
    expect(view.groups).toEqual(direct.groups);
  });

  it('follows the listing type like the search', async () => {
    const rent = await zips({ listingType: 'rent' });
    expect(rent.groups).toEqual([{ key: '00003', count: 1 }]);
    expect(rent.listingTotal).toBe(await searchTotal({ listingType: 'rent' }));
  });

  it('orders by key for order=name and breaks every count tie by key', async () => {
    const byName = await zips({ order: 'name' });
    expect(byName.groups.map((g) => g.key)).toEqual(['00001', '00002', '00003']);
  });

  it('pages with limit and offset, and keeps the exact totals', async () => {
    const page = await zips({ limit: 1, offset: 1 });
    expect(page.groups).toEqual([{ key: '00002', count: 2 }]);
    expect(page.total).toBe(3);
    expect(page.listingTotal).toBe(7);

    const past = await zips({ limit: 1, offset: 50 });
    expect(past).toEqual({ groups: [], total: 3, listingTotal: 7 });
  });

  it('omits a group below minCount and keeps listingTotal exact', async () => {
    const response = await zips({ minCount: 3 });
    expect(response.groups.map(({ key, count }) => ({ key, count }))).toEqual([
      { key: '00001', count: 3 },
    ]);
    expect(response.total).toBe(1);
    expect(response.listingTotal).toBe(await searchTotal());
  });

  it('answers 400 for an unknown parameter', async () => {
    await expect(axios.get('/listings/zips', { params: { nope: 1 } })).rejects.toMatchObject({
      response: { status: 400 },
    });
  });
});
