import { searchRequestSchema } from '@cribstop/property-contracts';

import { areaOf, createAreaLoader, placeSearchRequest, resolvedSearchRequest } from './on-demand';

const request = (input: Record<string, string>) => searchRequestSchema.parse(input);

describe('areaOf', () => {
  it('reads a ZIP from zip or from a five-digit query', () => {
    expect(areaOf(request({ zip: '20910' }))).toEqual({ zip: '20910' });
    expect(areaOf(request({ query: '20910' }))).toEqual({ zip: '20910' });
  });

  it('title-cases a city from city or from a place-shaped query', () => {
    expect(areaOf(request({ city: 'silver spring', state: 'md' }))).toEqual({
      city: 'Silver Spring',
      state: 'MD',
    });
    expect(areaOf(request({ query: 'WINSTON-SALEM' }))).toEqual({ city: 'Winston-Salem' });
  });

  it('parses "City, ST" out of a free-text query, upper-casing the state', () => {
    expect(areaOf(request({ query: 'Frederick, MD' }))).toEqual({
      city: 'Frederick',
      state: 'MD',
    });
  });

  it('parses "City ST" (no comma) out of a free-text query', () => {
    expect(areaOf(request({ query: 'Frederick MD' }))).toEqual({
      city: 'Frederick',
      state: 'MD',
    });
  });

  it('parses "City, ST 12345" out of a free-text query, keeping the ZIP alongside the city', () => {
    expect(areaOf(request({ query: 'Frederick, MD 21701' }))).toEqual({
      city: 'Frederick',
      state: 'MD',
      zip: '21701',
    });
  });

  it('never lets the city absorb the state token', () => {
    // Neither ends in exactly a two-letter word, so both stay a bare city with no state.
    expect(areaOf(request({ query: 'Ocean City' }))).toEqual({ city: 'Ocean City' });
    expect(areaOf(request({ query: 'New York' }))).toEqual({ city: 'New York' });
  });

  it('lets an explicit city/state win over query entirely', () => {
    expect(areaOf(request({ query: 'Frederick, MD', city: 'Rockville', state: 'VA' }))).toEqual({
      city: 'Rockville',
      state: 'VA',
    });
  });

  it('lets an explicit state win over the state a query carried', () => {
    expect(areaOf(request({ query: 'Frederick, MD', state: 'VA' }))).toEqual({
      city: 'Frederick',
      state: 'VA',
    });
  });

  it('returns null for a query that is not a place', () => {
    expect(areaOf(request({ query: '123 Main St #4' }))).toBeNull();
    expect(areaOf(request({}))).toBeNull();
  });
});

describe('placeSearchRequest', () => {
  it('carries only the parsed area, so a free-text and a structured search share one key', () => {
    const byQuery = areaOf(request({ query: 'Frederick, MD' }));
    const byFields = areaOf(request({ city: 'Frederick', state: 'MD' }));

    expect(byQuery).toEqual(byFields);
    expect(placeSearchRequest(byQuery!)).toEqual({ city: 'Frederick', state: 'MD' });
  });

  it('carries only city/state/zip, dropping nothing and adding nothing else', () => {
    expect(placeSearchRequest({ zip: '21701' })).toEqual({ zip: '21701' });
    expect(placeSearchRequest({ city: 'Rockville' })).toEqual({ city: 'Rockville' });
  });
});

describe('resolvedSearchRequest', () => {
  it('swaps a "City, ST" query for the parsed city and state', () => {
    const result = resolvedSearchRequest(request({ query: 'Frederick, MD' }));
    expect(result.query).toBeUndefined();
    expect(result.city).toBe('Frederick');
    expect(result.state).toBe('MD');
  });

  it('swaps a "City, ST 12345" query for the parsed city, state, and zip', () => {
    const result = resolvedSearchRequest(request({ query: 'Frederick, MD 21701' }));
    expect(result.query).toBeUndefined();
    expect(result.city).toBe('Frederick');
    expect(result.state).toBe('MD');
    expect(result.zip).toBe('21701');
  });

  it('keeps every other filter on the request untouched', () => {
    const result = resolvedSearchRequest(
      request({ query: 'Frederick, MD', minPrice: '100000', page: '2' }),
    );
    expect(result.minPrice).toBe(100000);
    expect(result.page).toBe(2);
  });

  it('leaves a bare-city query as-is, so a partial-name substring match still works', () => {
    const result = resolvedSearchRequest(request({ query: 'Fred' }));
    expect(result.query).toBe('Fred');
    expect(result.city).toBeUndefined();
  });

  it('leaves a ZIP-only query as-is', () => {
    const result = resolvedSearchRequest(request({ query: '21701' }));
    expect(result.query).toBe('21701');
  });

  it('leaves a query alongside an explicit state as-is, so the two stay independent filters', () => {
    const result = resolvedSearchRequest(request({ query: 'Frederick, MD', state: 'VA' }));
    expect(result.query).toBe('Frederick, MD');
    expect(result.state).toBe('VA');
  });

  it('leaves a request with no query, or one areaOf cannot parse, as-is', () => {
    const structured = request({ city: 'Frederick', state: 'MD' });
    expect(resolvedSearchRequest(structured)).toBe(structured);

    const notAPlace = request({ query: '123 Main St #4' });
    expect(resolvedSearchRequest(notAPlace)).toBe(notAPlace);
  });
});

describe('createAreaLoader', () => {
  it('skips every load when Bright is not configured', async () => {
    const loader = createAreaLoader({ env: {}, log: () => undefined });

    await expect(loader.load(request({ query: 'Rockville' }))).resolves.toBe('skipped');
  });
});
