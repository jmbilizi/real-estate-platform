import type { NeighborhoodRow } from '@cribstop/property-contracts';
import type { Neighborhood } from '@/components/NeighborhoodRow';
import {
  addNeighborhoodRows,
  groupedSearchHref,
  neighborhoodsHref,
  parseNeighborhoodsScope,
  usableFitBounds,
} from './neighborhoods';

function row(overrides: Partial<NeighborhoodRow> = {}): NeighborhoodRow {
  return {
    key: 'dc|washington|columbia heights',
    centroid: null,
    bounds: null,
    name: 'Columbia Heights',
    city: 'Washington',
    state: 'DC',
    slug: 'columbia-heights',
    total: 10,
    sale: 6,
    rent: 4,
    ...overrides,
  };
}

describe('parseNeighborhoodsScope', () => {
  it('returns all with no params', () => {
    expect(parseNeighborhoodsScope({})).toEqual({ kind: 'all' });
  });

  it('reads a state case-insensitively', () => {
    expect(parseNeighborhoodsScope({ state: 'md' })).toEqual({ kind: 'state', state: 'MD' });
  });

  it('adds a city when the state is licensed', () => {
    expect(parseNeighborhoodsScope({ state: 'va', city: ' Arlington ' })).toEqual({
      kind: 'city',
      state: 'VA',
      city: 'Arlington',
    });
  });

  it.each([['XX'], ['MDD'], ['1'], ['']])('falls back to all for state %p', (state) => {
    expect(parseNeighborhoodsScope({ state, city: 'Arlington' })).toEqual({ kind: 'all' });
  });

  it('treats a blank city as no city and uses the first of repeated values', () => {
    expect(parseNeighborhoodsScope({ state: ['dc', 'md'], city: '  ' })).toEqual({
      kind: 'state',
      state: 'DC',
    });
  });
});

describe('groupedSearchHref (#504)', () => {
  it('uses the default scope with no region', () => {
    expect(groupedSearchHref({ kind: 'all' })).toBe(
      '/homes-for-sale?type=all&groupBy=neighborhood',
    );
    expect(neighborhoodsHref(null)).toBe('/homes-for-sale?type=all&groupBy=neighborhood');
  });
  it('keeps a state scope', () => {
    expect(groupedSearchHref({ kind: 'state', state: 'MD' })).toBe(
      '/homes-for-sale?state=MD&type=all&groupBy=neighborhood',
    );
  });
  it('keeps a city scope as the city place path', () => {
    expect(neighborhoodsHref({ city: 'Rockville', state: 'MD' })).toBe(
      '/rockville-md/homes-for-sale?type=all&groupBy=neighborhood',
    );
  });
  it('treats a region with no state as the default scope', () => {
    expect(neighborhoodsHref({ city: 'Rockville', state: '' })).toBe(
      '/homes-for-sale?type=all&groupBy=neighborhood',
    );
  });
});

describe('addNeighborhoodRows', () => {
  it('dedupes by slug, city and state, ignoring case', () => {
    const seen = new Set<string>();
    const merged: Neighborhood[] = [];
    addNeighborhoodRows([row(), row({ city: 'WASHINGTON' }), row({ slug: 'other' })], seen, merged);
    addNeighborhoodRows([row()], seen, merged);
    expect(merged).toHaveLength(2);
  });

  it('keeps the same slug in a different city', () => {
    const merged: Neighborhood[] = [];
    addNeighborhoodRows([row(), row({ city: 'Arlington', state: 'VA' })], new Set(), merged);
    expect(merged).toHaveLength(2);
  });
});

describe('usableFitBounds (#503)', () => {
  const centroid = { lat: 38.93, lng: -77.03 };
  const good = { south: 38.92, west: -77.04, north: 38.95, east: -77.01 };

  it('keeps bounds that hold the centroid', () => {
    expect(usableFitBounds(row({ centroid, bounds: good }))).toEqual(good);
  });
  it('rejects null bounds', () => {
    expect(usableFitBounds(row({ centroid, bounds: null }))).toBeNull();
  });
  it('rejects bounds stretched to 0,0 by a stray coordinate', () => {
    expect(usableFitBounds(row({ centroid, bounds: { ...good, south: 0, east: 0 } }))).toBeNull();
  });
  it('rejects bounds that miss their centroid or span too wide', () => {
    expect(usableFitBounds(row({ centroid: { lat: 39.5, lng: -77.03 }, bounds: good }))).toBeNull();
    expect(usableFitBounds(row({ centroid, bounds: { ...good, north: 40.5 } }))).toBeNull();
  });
});
