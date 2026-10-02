import type { SearchPlace } from '@cribstop/property-contracts';
import {
  backToGroupsUrl,
  fromToken,
  legacyDrillUrl,
  neighborhoodDrillUrl,
  parseFromToken,
  scopeOf,
  type ViewType,
} from './neighborhood-url';

const oldTown = { name: 'Old Town', city: 'Alexandria', state: 'VA' };
const city: SearchPlace = { kind: 'city', city: 'Alexandria', state: 'VA' };
const county: SearchPlace = { kind: 'county', county: 'Fairfax County', state: 'VA' };

/** The drill-down URL for a grouped view, the way the results page builds it. */
function drill(options: {
  place: SearchPlace | null;
  filters?: { city?: string; state?: string };
  type: ViewType;
  count?: 'sale' | 'rent';
  query?: string;
}): string {
  return neighborhoodDrillUrl({
    target: oldTown,
    type: options.count ?? options.type,
    scope: scopeOf(options.place, options.filters ?? {}, oldTown),
    groupedType: options.type,
    carried: new URLSearchParams(options.query ?? 'groupBy=neighborhood'),
  });
}

describe('neighborhood drill-down URL (#533)', () => {
  describe('on a city grouped view', () => {
    it('is the neighborhood path with no city, state, groupFrom or groupBy', () => {
      expect(drill({ place: city, type: 'sale' })).toBe(
        '/alexandria-va/old-town-neighborhood/homes-for-sale',
      );
      expect(drill({ place: city, type: 'rent' })).toBe(
        '/alexandria-va/old-town-neighborhood/homes-for-rent',
      );
    });

    it('adds type=all only when the grouped view showed all types', () => {
      expect(drill({ place: city, type: 'all' })).toBe(
        '/alexandria-va/old-town-neighborhood/homes-for-sale?type=all',
      );
    });

    it('opens the count link on the path of its type, and records a different grouped type', () => {
      expect(drill({ place: city, type: 'sale', count: 'rent' })).toBe(
        '/alexandria-va/old-town-neighborhood/homes-for-rent?from=city.sale',
      );
      expect(drill({ place: city, type: 'all', count: 'sale' })).toBe(
        '/alexandria-va/old-town-neighborhood/homes-for-sale?from=city.all',
      );
      expect(drill({ place: city, type: 'all', count: 'rent' })).toBe(
        '/alexandria-va/old-town-neighborhood/homes-for-rent?from=city.all',
      );
      expect(drill({ place: city, type: 'sale', count: 'sale' })).toBe(
        '/alexandria-va/old-town-neighborhood/homes-for-sale',
      );
    });

    it('keeps the filters and the order, and drops the paging and the group by', () => {
      const url = drill({
        place: city,
        type: 'sale',
        query: 'beds=2&groupBy=neighborhood&groupOrder=name&page=3',
      });
      expect(url).toBe(
        '/alexandria-va/old-town-neighborhood/homes-for-sale?beds=2&groupOrder=name',
      );
    });
  });

  describe('on a grouped view that is not the city', () => {
    it('records a county scope', () => {
      expect(drill({ place: county, type: 'sale' })).toBe(
        '/alexandria-va/old-town-neighborhood/homes-for-sale?from=fairfax-county-va',
      );
      expect(drill({ place: county, type: 'all', count: 'rent' })).toBe(
        '/alexandria-va/old-town-neighborhood/homes-for-rent?from=fairfax-county-va.all',
      );
    });

    it('records a state scope', () => {
      expect(drill({ place: null, filters: { state: 'VA' }, type: 'sale' })).toBe(
        '/alexandria-va/old-town-neighborhood/homes-for-sale?from=VA',
      );
    });

    it('records no region', () => {
      expect(drill({ place: null, type: 'sale' })).toBe(
        '/alexandria-va/old-town-neighborhood/homes-for-sale?from=us',
      );
      expect(drill({ place: null, type: 'all', query: 'q=Alex&groupBy=neighborhood' })).toBe(
        '/alexandria-va/old-town-neighborhood/homes-for-sale?type=all&q=Alex&from=us',
      );
    });
  });

  it('never repeats the city or the state in the query of a city path', () => {
    const cases = [
      drill({ place: city, type: 'sale' }),
      drill({ place: city, type: 'all', count: 'rent', query: 'city=Alexandria&state=VA&beds=2' }),
      drill({ place: county, type: 'sale' }),
      drill({ place: null, filters: { state: 'VA' }, type: 'sale', query: 'state=VA' }),
      drill({ place: null, type: 'all' }),
    ];
    for (const url of cases) {
      const [path, query] = url.split('?');
      expect(path).toMatch(/^\/[a-z-]+-[a-z]{2}\/[a-z-]+-neighborhood\/homes-for-(sale|rent)$/);
      const params = new URLSearchParams(query);
      for (const key of ['city', 'state', 'neighborhood', 'groupFrom', 'groupBy']) {
        expect(params.has(key)).toBe(false);
      }
    }
  });

  it('gives two cities with the same neighborhood slug two different paths', () => {
    const other = { name: 'Old Town', city: 'Fairfax', state: 'VA' };
    const a = neighborhoodDrillUrl({ target: oldTown, type: 'sale', scope: '' });
    const b = neighborhoodDrillUrl({ target: other, type: 'sale', scope: '' });
    expect(a).toBe('/alexandria-va/old-town-neighborhood/homes-for-sale');
    expect(b).toBe('/fairfax-va/old-town-neighborhood/homes-for-sale');
  });
});

describe('from token', () => {
  it('is left out when the default arrow target is right', () => {
    expect(fromToken('', 'sale', 'sale')).toBeUndefined();
    expect(fromToken('', undefined, 'sale')).toBeUndefined();
  });

  it('round-trips a scope and a type', () => {
    expect(parseFromToken(fromToken('VA', 'all', 'rent'))).toEqual({ scope: 'VA', type: 'all' });
    expect(parseFromToken('city.sold')).toEqual({ scope: '', type: 'sold' });
    expect(parseFromToken('city.nonsense')).toEqual({ scope: '' });
    expect(parseFromToken(undefined)).toEqual({ scope: '' });
  });
});

describe('back arrow target (#533)', () => {
  const back = (from: string | null, current = 'type=all', type: ViewType = 'all') =>
    backToGroupsUrl({
      target: { city: 'Alexandria', state: 'VA' },
      type,
      from,
      current: new URLSearchParams(current),
    });

  it('derives the same city and type from the path', () => {
    expect(back(null, '', 'sale')).toBe('/alexandria-va/homes-for-sale?groupBy=neighborhood');
    expect(back(null, '', 'rent')).toBe('/alexandria-va/homes-for-rent?groupBy=neighborhood');
    expect(back(null)).toBe('/alexandria-va/homes-for-sale?type=all&groupBy=neighborhood');
  });

  it('keeps the filters and the order, and drops from and page', () => {
    expect(back(null, 'beds=2&groupOrder=name&page=2&from=city.sale', 'sale')).toBe(
      '/alexandria-va/homes-for-sale?beds=2&groupOrder=name&groupBy=neighborhood',
    );
  });

  it('returns to a county, a state, or no region when from says so', () => {
    expect(back('fairfax-county-va', '', 'sale')).toBe(
      '/fairfax-county-va/homes-for-sale?groupBy=neighborhood',
    );
    expect(back('VA', '', 'sale')).toBe('/homes-for-sale?groupBy=neighborhood&state=VA');
    expect(back('us', 'q=Alex', 'sale')).toBe('/homes-for-sale?q=Alex&groupBy=neighborhood');
  });

  it('returns to the grouped view type that from records', () => {
    expect(back('city.all', '', 'sale')).toBe(
      '/alexandria-va/homes-for-sale?type=all&groupBy=neighborhood',
    );
    expect(back('fairfax-county-va.rent', '', 'sale')).toBe(
      '/fairfax-county-va/homes-for-rent?groupBy=neighborhood',
    );
  });

  it('returns to the ZIP path when the drill-down carried a ZIP', () => {
    expect(back(null, 'zip=22304', 'sale')).toBe(
      '/alexandria-va/22304/homes-for-sale?groupBy=neighborhood',
    );
  });

  it('ignores a from value it cannot read', () => {
    expect(back('not-a-place', '', 'sale')).toBe(
      '/alexandria-va/homes-for-sale?groupBy=neighborhood',
    );
    expect(back('alexandria-va/22304', '', 'sale')).toBe(
      '/alexandria-va/homes-for-sale?groupBy=neighborhood',
    );
  });

  it('is the inverse of the drill-down URL', () => {
    const cases: Array<[SearchPlace | null, { state?: string }, ViewType]> = [
      [city, {}, 'sale'],
      [city, {}, 'all'],
      [county, {}, 'sale'],
      [null, { state: 'VA' }, 'sale'],
      [null, {}, 'rent'],
    ];
    for (const [place, filters, type] of cases) {
      for (const count of [undefined, 'sale', 'rent'] as const) {
        const url = drill({ place, filters, type, count });
        const [, query = ''] = url.split('?');
        const params = new URLSearchParams(query);
        const effective = count ?? type;
        const result = backToGroupsUrl({
          target: oldTown,
          type: effective,
          from: params.get('from'),
          current: params,
        });
        const expectedPath =
          place?.kind === 'county' ? '/fairfax-county-va' : place === null ? '' : '/alexandria-va';
        const seg = type === 'rent' ? 'homes-for-rent' : 'homes-for-sale';
        expect(result.startsWith(`${expectedPath}/${seg}`)).toBe(true);
        expect(new URLSearchParams(result.split('?')[1]).get('type')).toBe(
          type === 'all' ? 'all' : null,
        );
      }
    }
  });
});

describe('old links (#525)', () => {
  const legacy = (place: SearchPlace | null, type: ViewType, query: string) =>
    legacyDrillUrl(place, type, new URLSearchParams(query));

  it('turns a city path drill-down into the neighborhood path', () => {
    expect(
      legacy(city, 'sale', 'city=Alexandria&state=VA&neighborhood=Old+Town&groupFrom=%7C%7Csale'),
    ).toBe('/alexandria-va/old-town-neighborhood/homes-for-sale');
  });

  it('reads the city scope of groupFrom as the default', () => {
    expect(
      legacy(
        city,
        'sale',
        'city=Alexandria&state=VA&neighborhood=Old+Town&groupFrom=Alexandria%7CVA%7Csale',
      ),
    ).toBe('/alexandria-va/old-town-neighborhood/homes-for-sale');
  });

  it('keeps the all type and the filters', () => {
    expect(
      legacy(
        city,
        'all',
        'city=Alexandria&state=VA&neighborhood=Old+Town&beds=2&type=all&groupFrom=Alexandria%7CVA%7Call',
      ),
    ).toBe('/alexandria-va/old-town-neighborhood/homes-for-sale?type=all&beds=2');
  });

  it('records the county of a county path', () => {
    expect(
      legacy(
        county,
        'sale',
        'city=Alexandria&state=VA&neighborhood=Old+Town&groupFrom=%7CVA%7Csale',
      ),
    ).toBe('/alexandria-va/old-town-neighborhood/homes-for-sale?from=fairfax-county-va');
  });

  it('keeps the way back to a type that a count link left', () => {
    expect(
      legacy(
        city,
        'rent',
        'city=Alexandria&state=VA&neighborhood=Old+Town&groupFrom=Alexandria%7CVA%7Call',
      ),
    ).toBe('/alexandria-va/old-town-neighborhood/homes-for-rent?from=city.all');
  });

  it('reads a link with no groupFrom as the neighborhood city', () => {
    expect(legacy(null, 'sale', 'city=Alexandria&state=VA&neighborhood=Old+Town')).toBe(
      '/alexandria-va/old-town-neighborhood/homes-for-sale',
    );
  });

  it('is null without a neighborhood, a city and a state', () => {
    expect(legacy(city, 'sale', 'city=Alexandria&state=VA')).toBeNull();
    expect(legacy(city, 'sale', 'neighborhood=Old+Town')).toBeNull();
  });
});
