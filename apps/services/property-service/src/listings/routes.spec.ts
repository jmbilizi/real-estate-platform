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
      .query({ neighborhood: 'Fishtown' });

    expect(response.status).toBe(400);
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
    expect(calls[0]?.[0]).toContain('unnest($7::text[], $8::text[])');
    expect(calls[0]?.[1]).toHaveLength(8);
    expect(calls[0]?.[1].slice(6)).toEqual([
      ['MD', 'DC'],
      ['Bethesda', 'Chevy Chase'],
    ]);
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

  it('rejects listingType=sold, which this endpoint does not accept', async () => {
    const response = await request(createApp({ pool: neighborhoodsPool([]) }))
      .get('/listings/neighborhoods')
      .query({ listingType: 'sold' });

    expect(response.status).toBe(400);
  });
});
