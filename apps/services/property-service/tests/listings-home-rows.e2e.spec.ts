import axios from 'axios';
import { listingsEnvelopeSchema } from '@cribstop/property-contracts';

/**
 * #755. The home page fires one request per row, all at once, on every page load. This suite sends
 * the same set against a REAL service and database and holds it to two limits:
 *
 *  - every request answers 200, never a 5xx or a timeout, under the burst a page load makes;
 *  - every row answers inside `ROW_BUDGET_MS`, below the gateway's 5 s QoS timeout and the
 *    service's own 4 s statement timeout. A row slower than that shows "Failed to load" to a
 *    visitor.
 *
 * The fixture database is small, so the budget is generous. It still fails if a row regains the
 * exact-count scan the rows skip, or loses its index, because the wait then grows with the data.
 */
const ROW_BUDGET_MS = 2_000;

const HOME_ROWS = [
  '/listings?sort=newly-listed&listingType=sale&pageSize=8&skipTotal=true',
  '/listings?sort=newly-listed&listingType=rent&pageSize=8&skipTotal=true',
  '/listings?status=Coming%20Soon&sort=newest&listingType=sale&pageSize=8&skipTotal=true',
  '/listings?status=Coming%20Soon&sort=newest&listingType=rent&pageSize=8&skipTotal=true',
  '/listings?priceReduced=true&sort=newly-listed&listingType=sale&pageSize=8&skipTotal=true',
  '/listings?listingType=sale&sort=price-asc&minPrice=5000&pageSize=8&skipTotal=true',
  '/listings?listingType=rent&sort=price-desc&minPrice=200&pageSize=8&skipTotal=true',
] as const;

const HOME_AGGREGATES = [
  '/listings/meta',
  '/listings/neighborhoods?state=MD&limit=24&minCount=5',
  '/listings/neighborhoods?state=DC&limit=24&minCount=5',
  '/listings/neighborhoods?state=VA&limit=24&minCount=5',
] as const;

async function timed(path: string): Promise<{ status: number; ms: number }> {
  const started = Date.now();
  const response = await axios.get(path, { validateStatus: () => true });
  return { status: response.status, ms: Date.now() - started };
}

describe('home page rows under a page-load burst (#755)', () => {
  it('answers every row and aggregate with 200 inside the budget, for five visitors at once', async () => {
    const visitors = Array.from({ length: 5 }, () =>
      Promise.all([...HOME_ROWS, ...HOME_AGGREGATES].map(timed)),
    );

    const results = (await Promise.all(visitors)).flat();

    expect(results.filter((r) => r.status !== 200)).toEqual([]);
    expect(Math.max(...results.map((r) => r.ms))).toBeLessThan(ROW_BUDGET_MS);
  });

  describe('skipTotal', () => {
    it('returns the same cards as the exact-count search, in the same order', async () => {
      const exact = listingsEnvelopeSchema.parse(
        (await axios.get('/listings?sort=newly-listed&listingType=sale&pageSize=8')).data,
      );
      const skipped = listingsEnvelopeSchema.parse(
        (await axios.get('/listings?sort=newly-listed&listingType=sale&pageSize=8&skipTotal=true'))
          .data,
      );

      expect(skipped.results.map((card) => card.id)).toEqual(exact.results.map((card) => card.id));
    });

    it('reports the size of the page as total, and one page at most', async () => {
      const skipped = listingsEnvelopeSchema.parse(
        (await axios.get('/listings?listingType=sale&pageSize=8&skipTotal=true')).data,
      );

      expect(skipped.total).toBe(skipped.results.length);
      expect(skipped.pageCount).toBe(skipped.results.length > 0 ? 1 : 0);
    });

    it('rejects a value that is not true or false', async () => {
      const response = await axios.get('/listings?skipTotal=maybe', {
        validateStatus: () => true,
      });

      expect(response.status).toBe(400);
    });

    it('is not a parameter of the map or neighborhoods endpoints', async () => {
      const response = await axios.get('/listings/neighborhoods?skipTotal=true', {
        validateStatus: () => true,
      });

      expect(response.status).toBe(400);
    });
  });
});
