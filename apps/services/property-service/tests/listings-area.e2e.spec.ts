import axios from 'axios';
import {
  brokersResponseSchema,
  listingsEnvelopeSchema,
  mapResponseSchema,
  neighborhoodsResponseSchema,
  zipsResponseSchema,
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
 * #747. A drawn `area` against a REAL service and a REAL database. Three homes:
 * - `inside`: inside the shape and inside the searched city.
 * - `otherCity`: inside the shape and outside the searched city.
 * - `outside`: outside the shape and inside the searched city.
 * Only `inside` matches `city + area`. Every read path must agree.
 */

const OTHER_CITY = 'Areaville';
const LISTED = '2026-09-18T00:00:00.000Z';

const HOMES: HomeInput[] = [
  {
    street: '1 Inside Rd',
    zip: '00001',
    latitude: 20.5,
    longitude: 20.5,
    records: [{ listedAt: LISTED, officeKey: '111' }],
  },
  {
    street: '2 Other City Rd',
    zip: '00002',
    city: OTHER_CITY,
    latitude: 20.501,
    longitude: 20.501,
    records: [{ listedAt: LISTED, officeKey: '222' }],
  },
  {
    street: '3 Outside Rd',
    zip: '00003',
    latitude: 20.6,
    longitude: 20.6,
    records: [{ listedAt: LISTED, officeKey: '333' }],
  },
  {
    // A withheld address has no geography. It never matches a shape.
    street: '4 Hidden Rd',
    zip: '00004',
    latitude: 20.5,
    longitude: 20.5,
    records: [{ listedAt: LISTED, addressHidden: true }],
  },
];

const ring = (points: [number, number][]): string =>
  JSON.stringify({ type: 'Polygon', coordinates: [[...points, points[0]]] });

// Counter-clockwise and clockwise squares around 20.5, 20.5 (lng, lat).
const SHAPE_CCW = ring([
  [20.49, 20.49],
  [20.51, 20.49],
  [20.51, 20.51],
  [20.49, 20.51],
]);
const SHAPE_CW = ring([
  [20.49, 20.49],
  [20.49, 20.51],
  [20.51, 20.51],
  [20.51, 20.49],
]);
const BOWTIE = ring([
  [20.49, 20.49],
  [20.51, 20.51],
  [20.51, 20.49],
  [20.49, 20.51],
]);

const SEARCH = { state: COLLAPSE_STATE, status: 'Active,Coming Soon,Pending' };
const pool = getPool();

const cards = async (params: Record<string, unknown>) =>
  listingsEnvelopeSchema.parse(
    (await axios.get('/listings', { params: { ...SEARCH, ...params } })).data,
  );

beforeAll(async () => {
  await seedHomes(pool, HOMES);
});

afterAll(async () => {
  await removeCollapseFixtures(pool);
  await closePool();
});

describe('area (#747)', () => {
  it.each([
    ['counter-clockwise', SHAPE_CCW],
    ['clockwise', SHAPE_CW],
  ])('returns the homes inside a %s shape, in every city', async (_name, area) => {
    const body = await cards({ area });
    expect(body.total).toBe(2);
  });

  it('ANDs the shape with the searched place', async () => {
    const inCity = await cards({ city: COLLAPSE_CITY, area: SHAPE_CCW });
    expect(inCity.total).toBe(1);
    const other = await cards({ city: OTHER_CITY, area: SHAPE_CCW });
    expect(other.total).toBe(1);
    expect((await cards({ city: COLLAPSE_CITY })).total).toBe(3);
  });

  it('applies to the map pins and total', async () => {
    const response = await axios.get('/listings/map', {
      params: { ...SEARCH, city: COLLAPSE_CITY, area: SHAPE_CCW, bounds: '20.4,20.4,20.7,20.7' },
    });
    const body = mapResponseSchema.parse(response.data);
    expect(body.total).toBe(1);
    expect(body.pins).toHaveLength(1);
  });

  it('applies to every group-by, and group sums equal the search total', async () => {
    const params = { ...SEARCH, city: COLLAPSE_CITY, area: SHAPE_CCW };
    const zips = zipsResponseSchema.parse((await axios.get('/listings/zips', { params })).data);
    expect(zips.listingTotal).toBe(1);
    expect(zips.groups.map((g) => g.key)).toEqual(['00001']);

    const brokers = brokersResponseSchema.parse(
      (await axios.get('/listings/brokers', { params })).data,
    );
    expect(brokers.listingTotal).toBe(1);
    expect(brokers.groups.map((g) => g.key)).toEqual(['111']);

    const hoods = neighborhoodsResponseSchema.parse(
      (await axios.get('/listings/neighborhoods', { params: { ...params, minCount: 1 } })).data,
    );
    expect(hoods.results.reduce((sum, row) => sum + row.total, 0)).toBe(1);
  });

  it('never matches a withheld address', async () => {
    const body = await cards({ city: COLLAPSE_CITY, area: SHAPE_CCW });
    expect(body.total).toBe(1);
  });

  it('answers 400, never 500, for a self-intersecting shape', async () => {
    const response = await axios.get('/listings', {
      params: { ...SEARCH, area: BOWTIE },
      validateStatus: () => true,
    });
    expect(response.status).toBe(400);
  });
});
