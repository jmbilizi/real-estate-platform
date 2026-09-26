import request from 'supertest';
import { createApp } from '../app';
import type { AreaLoader, AreaLoadOutcome } from './on-demand';
import type { ReadPool } from './repository';
import { cardDbRowFixture } from './test-fixtures';

/**
 * The on-demand load TRIGGER decision in `createListingsRouter` (#329): `bright_area_sync`
 * coverage decides whether a load runs, not `envelope.total === 0` alone, and a price/bed filter
 * that empties a place we DO hold must never trigger one. Exercised through the real Express app
 * against a fake pool and a fake `AreaLoader`, so the assertions are about what the route actually
 * calls, not a reimplementation of its logic.
 */

/** `v.price >=` only appears in the WHERE clause of a request carrying `minPrice` — never in the
 *  place-only request `placeHasNoListings` builds from `placeSearchRequest()`. */
const FILTERED_SQL_MARKER = 'v.price >=';

interface FakeAreaLoader extends AreaLoader {
  readonly loadCalls: number;
  readonly needsLoadCalls: number;
}

function fakeAreaLoader(
  needsLoad: boolean,
  loadOutcome: AreaLoadOutcome = 'loaded',
): FakeAreaLoader {
  let loadCalls = 0;
  let needsLoadCalls = 0;
  return {
    get loadCalls() {
      return loadCalls;
    },
    get needsLoadCalls() {
      return needsLoadCalls;
    },
    async needsLoad() {
      needsLoadCalls += 1;
      return needsLoad;
    },
    async load() {
      loadCalls += 1;
      return loadOutcome;
    },
    async loadGallery() {
      return 'skipped';
    },
  };
}

/** A fake pool answering the FILTERED search with `filteredTotal` and the PLACE-ONLY search
 *  (`placeHasNoListings`) with `placeTotal`. Both counts default to matching, i.e. no filter. */
function fakePool(filteredTotal: number, placeTotal = filteredTotal): ReadPool {
  const query = <T>(text: string): Promise<{ rows: T[] }> => {
    if (text.includes('count(*)::int AS total')) {
      const total = text.includes(FILTERED_SQL_MARKER) ? filteredTotal : placeTotal;
      return Promise.resolve({ rows: [{ total }] as T[] });
    }
    return Promise.resolve({ rows: [cardDbRowFixture()] as T[] });
  };
  return { query, connect: () => Promise.resolve({ query, release: () => undefined }) };
}

describe('GET /listings triggers an on-demand load on bright_area_sync coverage, not just total===0', () => {
  it('triggers for a partial/stale area even though the (unfiltered) place already has rows', async () => {
    const loader = fakeAreaLoader(true);
    const response = await request(createApp({ pool: fakePool(5), areaLoader: loader }))
      .get('/listings')
      .query({ city: 'Frederick' });

    expect(response.status).toBe(200);
    expect(loader.needsLoadCalls).toBe(1);
    expect(loader.loadCalls).toBe(1);
  });

  it('never triggers when coverage says the area is complete and fresh, even with zero results', async () => {
    const loader = fakeAreaLoader(false);
    const response = await request(createApp({ pool: fakePool(0), areaLoader: loader }))
      .get('/listings')
      .query({ city: 'Frederick' });

    expect(response.status).toBe(200);
    expect(loader.needsLoadCalls).toBe(1);
    expect(loader.loadCalls).toBe(0);
  });

  it('never triggers when a price/bed filter empties a place we DO hold, even if coverage needs a load', async () => {
    // filteredTotal = 0 (this request's own result), placeTotal = 3 (the place alone has rows) —
    // the guard must read the second number, not the first.
    const loader = fakeAreaLoader(true);
    const response = await request(createApp({ pool: fakePool(0, 3), areaLoader: loader }))
      .get('/listings')
      .query({ city: 'Frederick', minPrice: 900000 });

    expect(response.status).toBe(200);
    expect(loader.needsLoadCalls).toBe(1);
    expect(loader.loadCalls).toBe(0);
  });

  it('still triggers on a genuine zero (the place itself has nothing), when coverage needs a load', async () => {
    const loader = fakeAreaLoader(true);
    const response = await request(createApp({ pool: fakePool(0, 0), areaLoader: loader }))
      .get('/listings')
      .query({ city: 'Nowhereville' });

    expect(response.status).toBe(200);
    expect(loader.loadCalls).toBe(1);
  });

  it('answers without waiting on the load, and marks that response uncacheable (#337)', async () => {
    const loader = fakeAreaLoader(true);
    let loadStarted = false;
    const stalled: AreaLoader = {
      ...loader,
      needsLoad: () => Promise.resolve(true),
      load: () => {
        loadStarted = true;
        return new Promise<AreaLoadOutcome>(() => undefined);
      },
    };
    const response = await request(createApp({ pool: fakePool(5), areaLoader: stalled }))
      .get('/listings')
      .query({ city: 'Frederick' });

    expect(response.status).toBe(200);
    expect(loadStarted).toBe(true);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('never checks coverage past page 1', async () => {
    const loader = fakeAreaLoader(true);
    await request(createApp({ pool: fakePool(50), areaLoader: loader }))
      .get('/listings')
      .query({ city: 'Frederick', page: 2 });

    expect(loader.needsLoadCalls).toBe(0);
    expect(loader.loadCalls).toBe(0);
  });
});
