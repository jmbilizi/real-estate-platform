import { filtersToSearchParams, parseFiltersFromSearchParams } from './listing-filters';

describe('the map view in the URL (#558)', () => {
  const view = { west: -77.0602, south: 38.7977, east: -77.0301, north: 38.8189 };
  const text = 'viewport=-77.06020,38.79770,-77.03010,38.81890';

  it('parses bounds into numbers', () => {
    expect(parseFiltersFromSearchParams(new URLSearchParams(text)).bounds).toEqual(view);
  });

  it.each(['-77,38,-78,39', '1,2,3', 'x', ''])('drops the malformed value %j', (value) => {
    const params = new URLSearchParams({ viewport: value });
    expect(parseFiltersFromSearchParams(params).bounds).toBeUndefined();
  });

  it('writes bounds back and round-trips', () => {
    const written = filtersToSearchParams({ bounds: view });

    expect(written.toString()).toBe(new URLSearchParams(text).toString());
    expect(parseFiltersFromSearchParams(written).bounds).toEqual(view);
  });

  it('does not read the map-area search `bounds=<n,e,s,w>` as a view', () => {
    const legacy = new URLSearchParams('bounds=38.8189,-77.0301,38.7977,-77.0602');

    expect(parseFiltersFromSearchParams(legacy).bounds).toBeUndefined();
  });

  it('removes a stale bounds when the filter set has none', () => {
    const base = new URLSearchParams(`q=Alexandria&${text}`);

    expect(filtersToSearchParams({ query: 'Alexandria' }, base).has('viewport')).toBe(false);
  });
});
