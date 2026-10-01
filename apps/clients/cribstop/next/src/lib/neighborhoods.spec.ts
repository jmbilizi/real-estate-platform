import type { NeighborhoodRow } from '@cribstop/property-contracts';
import type { Neighborhood } from '@/components/NeighborhoodRow';
import {
  addNeighborhoodRows,
  neighborhoodsMetadata,
  parseNeighborhoodsScope,
  scopeStates,
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

describe('scopeStates', () => {
  it('lists the licensed states in brand order for all', () => {
    expect(scopeStates({ kind: 'all' })).toEqual(['MD', 'DC', 'VA']);
    expect(scopeStates({ kind: 'state', state: 'DC' })).toEqual(['DC']);
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

describe('neighborhoodsMetadata', () => {
  it('gives each scope a unique title and description', () => {
    const all = neighborhoodsMetadata({ kind: 'all' }, null);
    const state = neighborhoodsMetadata({ kind: 'state', state: 'MD' }, null);
    const city = neighborhoodsMetadata({ kind: 'city', state: 'MD', city: 'Bethesda' }, null);
    expect(new Set([all.title, state.title, city.title]).size).toBe(3);
    expect(new Set([all.description, state.description, city.description]).size).toBe(3);
  });

  it('sets the canonical without the city, on the origin when there is one', () => {
    expect(neighborhoodsMetadata({ kind: 'all' }, null).alternates?.canonical).toBe(
      '/neighborhoods',
    );
    expect(
      neighborhoodsMetadata({ kind: 'city', state: 'MD', city: 'Bethesda' }, 'https://x.test')
        .alternates?.canonical,
    ).toBe('https://x.test/neighborhoods?state=MD');
  });

  it('is indexable and uses no price, ranking or best language', () => {
    for (const scope of [
      { kind: 'all' },
      { kind: 'state', state: 'VA' },
      { kind: 'city', state: 'VA', city: 'Arlington' },
    ] as const) {
      const meta = neighborhoodsMetadata(scope, null);
      expect(meta.robots).toBeUndefined();
      expect(`${meta.title} ${meta.description}`).not.toMatch(
        /best|top|\$|price|cheap|popular|rank/i,
      );
    }
  });
});
