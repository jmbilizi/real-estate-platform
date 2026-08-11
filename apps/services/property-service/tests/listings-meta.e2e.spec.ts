import axios from 'axios';
import {
  LISTING_SOURCES,
  listingsEnvelopeSchema,
  listingsMetaSchema,
} from '@cribstop/property-contracts';

/**
 * `GET /listings/meta` against a REAL service and REAL database.
 *
 * Unlike the other e2e suites, this file does not need `complianceFixtureIds()` — none of its
 * assertions require a specific fixture row to exist. `sources`/`dataUpdatedAt`/`listingCount` are
 * aggregates over whatever is currently visible in `listing_search_v`, so they hold whether or not
 * the guarded fixtures happen to be loaded for this run.
 */

describe('dataUpdatedAt is MLS feed freshness, never a fabricated or future timestamp', () => {
  it('is a valid ISO instant that is never ahead of the clock — feed freshness cannot be from the future', async () => {
    const response = await axios.get('/listings/meta');
    const meta = listingsMetaSchema.parse(response.data);

    expect(meta.dataUpdatedAt).not.toBeNull();
    const asMillis = Date.parse(meta.dataUpdatedAt as string);
    expect(Number.isNaN(asMillis)).toBe(false);
    expect(asMillis).toBeLessThanOrEqual(Date.now());
  });
});

describe('sources reflects only real provenance', () => {
  it('contains only values from the closed LISTING_SOURCES set, and never brightMLS — every row here is internal, and claiming Bright provenance for data Bright never supplied is a false provenance claim (#24 gates its IDX disclosure block on this field)', async () => {
    const response = await axios.get('/listings/meta');
    const meta = listingsMetaSchema.parse(response.data);

    for (const source of meta.sources) {
      expect(LISTING_SOURCES).toContain(source);
    }
    expect(meta.sources).not.toContain('brightMLS');
  });
});

describe('listingCount vs. the unfiltered search total', () => {
  it('is at least the unfiltered search total — meta counts the WHOLE visible set including sold, while the default/listingType=all search excludes sold, so listingCount can exceed total but must never fall short of it', async () => {
    const metaResponse = await axios.get('/listings/meta');
    const meta = listingsMetaSchema.parse(metaResponse.data);
    const searchResponse = await axios.get('/listings');
    const envelope = listingsEnvelopeSchema.parse(searchResponse.data);

    expect(meta.listingCount).toBeGreaterThanOrEqual(envelope.total);
  });
});

describe('reachable independent of search', () => {
  it('answers 200 with no prior search request in this test — Footer mounts in the root layout and renders on routes that never search, so meta must not depend on search having run first', async () => {
    const response = await axios.get('/listings/meta');

    expect(response.status).toBe(200);
    listingsMetaSchema.parse(response.data);
  });
});

describe('cache headers', () => {
  it('sets Cache-Control to exactly "public, max-age=60, s-maxage=300, stale-while-revalidate=60" — the shared cache can hold this far longer than the browser because it is a cheap indexed MAX+COUNT, five minutes being an order of magnitude tighter than any MLS refresh obligation', async () => {
    const response = await axios.get('/listings/meta');

    expect(response.headers['cache-control']).toBe(
      'public, max-age=60, s-maxage=300, stale-while-revalidate=60',
    );
  });
});
