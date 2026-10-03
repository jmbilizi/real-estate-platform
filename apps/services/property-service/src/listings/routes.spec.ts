import request from 'supertest';
import { createApp } from '../app';
import type { GalleryLoader, GalleryLoadOutcome } from './gallery-loader';
import type { ReadPool } from './repository';
import { cardDbRowFixture } from './test-fixtures';

/**
 * Search reads Postgres only (#337, #338). The sync worker keeps the database current, so no search
 * request calls Bright or waits on it. Exercised through the real Express app against a fake pool
 * and a fake `GalleryLoader`, so the assertions are about what the route actually calls.
 */

function countingGalleryLoader(outcome: GalleryLoadOutcome = 'loaded'): GalleryLoader & {
  readonly calls: number;
} {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    loadGallery() {
      calls += 1;
      return Promise.resolve(outcome);
    },
  };
}

function fakePool(total: number): ReadPool {
  const query = <T>(text: string): Promise<{ rows: T[] }> => {
    if (text.includes('count(*)::int AS total')) {
      return Promise.resolve({ rows: [{ total }] as T[] });
    }
    return Promise.resolve({ rows: total === 0 ? [] : ([cardDbRowFixture()] as T[]) });
  };
  return { query, connect: () => Promise.resolve({ query, release: () => undefined }) };
}

describe('GET /listings never calls Bright', () => {
  it('answers from the database and never starts a gallery or area load', async () => {
    const loader = countingGalleryLoader();
    const response = await request(createApp({ pool: fakePool(5), galleryLoader: loader }))
      .get('/listings')
      .query({ city: 'Frederick' });

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(5);
    expect(loader.calls).toBe(0);
    expect(response.headers['cache-control']).toBe('public, max-age=60');
  });

  it('answers an empty place with an ordinary cacheable empty page', async () => {
    const loader = countingGalleryLoader();
    const response = await request(createApp({ pool: fakePool(0), galleryLoader: loader }))
      .get('/listings')
      .query({ city: 'Nowhereville' });

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(0);
    expect(loader.calls).toBe(0);
    expect(response.headers['cache-control']).toBe('public, max-age=60');
  });
});

/** #549. */
describe('GET /listings/:id/card', () => {
  const ID = '018f2f2a-6d1b-7c3d-8b2e-000000000001';

  function cardPool(rows: unknown[]): { pool: ReadPool; texts: string[] } {
    const texts: string[] = [];
    const query = <T>(text: string): Promise<{ rows: T[] }> => {
      texts.push(text);
      return Promise.resolve({ rows: rows as T[] });
    };
    return {
      pool: { query, connect: () => Promise.resolve({ query, release: () => undefined }) },
      texts,
    };
  }

  it('returns the search card for one listing, with no gallery fetch', async () => {
    const loader = countingGalleryLoader();
    const { pool, texts } = cardPool([cardDbRowFixture()]);
    const response = await request(createApp({ pool, galleryLoader: loader })).get(
      `/listings/${ID}/card`,
    );

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(ID);
    expect(response.headers['cache-control']).toBe('public, max-age=60');
    expect(loader.calls).toBe(0);
    // One read of the visibility view, and no other table decides who may see the card.
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain('FROM listing_search_v v');
  });

  it('keeps the address, coordinates and unit number masked together', async () => {
    const { pool } = cardPool([
      cardDbRowFixture({ address: null, latitude: null, longitude: null, unit_number: '4B' }),
    ]);
    const response = await request(createApp({ pool })).get(`/listings/${ID}/card`);

    expect(response.status).toBe(200);
    expect(response.body.address).toBeNull();
    expect(response.body.latitude).toBeNull();
    expect(response.body.longitude).toBeNull();
    expect(JSON.stringify(response.body)).not.toContain('4B');
  });

  it('answers an unknown, suppressed or malformed id with the same 404', async () => {
    const { pool } = cardPool([]);
    const app = createApp({ pool });
    const unknown = await request(app).get(`/listings/${ID}/card`);
    const malformed = await request(app).get('/listings/not-an-id/card');

    expect(unknown.status).toBe(404);
    expect(malformed.status).toBe(404);
    expect(unknown.body).toEqual(malformed.body);
  });
});

/** #390. */
describe('GET /listings/neighborhoods', () => {
  function neighborhoodsPool(rows: unknown[]): ReadPool {
    const query = <T>(): Promise<{ rows: T[] }> => Promise.resolve({ rows: rows as T[] });
    return { query, connect: () => Promise.resolve({ query, release: () => undefined }) };
  }

  it('answers with the same cache-control as /listings/meta', async () => {
    const response = await request(createApp({ pool: neighborhoodsPool([]) })).get(
      '/listings/neighborhoods',
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ results: [], total: 0 });
    expect(response.headers['cache-control']).toBe(
      'public, max-age=60, s-maxage=300, stale-while-revalidate=60',
    );
  });

  it('rejects an unknown query parameter with 400', async () => {
    const response = await request(createApp({ pool: neighborhoodsPool([]) }))
      .get('/listings/neighborhoods')
      .query({ nope: 'Fishtown' });

    expect(response.status).toBe(400);
  });

  it('rejects the listing search paging parameters (#501)', async () => {
    const response = await request(createApp({ pool: neighborhoodsPool([]) }))
      .get('/listings/neighborhoods')
      .query({ page: '2' });

    expect(response.status).toBe(400);
  });

  it('accepts the search filters and group paging (#501)', async () => {
    const response = await request(createApp({ pool: neighborhoodsPool([]) }))
      .get('/listings/neighborhoods')
      .query({
        neighborhood: 'Fishtown',
        city: 'Philadelphia',
        state: 'PA',
        minPrice: '300000',
        minCount: '1',
        limit: '10',
        offset: '20',
        order: 'name',
      });

    expect(response.status).toBe(200);
  });

  it('rejects an unknown order and an offset past the window (#501)', async () => {
    const app = createApp({ pool: neighborhoodsPool([]) });

    expect((await request(app).get('/listings/neighborhoods?order=rank')).status).toBe(400);
    expect((await request(app).get('/listings/neighborhoods?offset=10001')).status).toBe(400);
  });

  it('passes a repeated place list to one query as two bound arrays (#488)', async () => {
    const query = jest.fn(() => Promise.resolve({ rows: [] }));
    const pool = { query, connect: () => Promise.resolve({ query, release: () => undefined }) };
    const response = await request(createApp({ pool: pool as unknown as ReadPool })).get(
      '/listings/neighborhoods?place=Bethesda,md&place=Chevy%20Chase,DC',
    );

    expect(response.status).toBe(200);
    expect(query).toHaveBeenCalledTimes(1);
    const calls = query.mock.calls as unknown as [string, unknown[]][];
    expect(calls[0]?.[0]).toContain('unnest(');
    expect(calls[0]?.[1]).toEqual(
      expect.arrayContaining([
        ['MD', 'DC'],
        ['Bethesda', 'Chevy Chase'],
      ]),
    );
  });

  it('rejects place with city, naming both parameters (#488)', async () => {
    const response = await request(createApp({ pool: neighborhoodsPool([]) }))
      .get('/listings/neighborhoods')
      .query({ place: 'Bethesda,MD', city: 'Bethesda' });

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toMatch(/place, city/);
  });

  it('rejects 26 places with 400 (#488)', async () => {
    const places = Array.from({ length: 26 }, (_v, i) => `place=City${i},MD`).join('&');
    const response = await request(createApp({ pool: neighborhoodsPool([]) })).get(
      `/listings/neighborhoods?${places}`,
    );

    expect(response.status).toBe(400);
  });

  it('accepts listingType=sold, like the search (#501)', async () => {
    const response = await request(createApp({ pool: neighborhoodsPool([]) }))
      .get('/listings/neighborhoods')
      .query({ listingType: 'sold' });

    expect(response.status).toBe(200);
  });
});
