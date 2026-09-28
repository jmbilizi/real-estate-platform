import searchReducer from '@/lib/store/slices/searchSlice';
import {
  boundsToBoundary,
  legacySearchUrl,
  listingTypeForPath,
  searchableSuggestions,
  searchTargetFor,
  searchTargetUrl,
} from './search-place';

const ALEXANDRIA = { city: 'Alexandria', state: 'Virginia', 'ISO3166-2-lvl4': 'US-VA' };

describe('searchTargetFor + searchTargetUrl (#350)', () => {
  const url = (typed: string, loc: any, type: any = 'sale') => {
    const target = searchTargetFor(typed, loc);
    return target && searchTargetUrl(target, type);
  };

  it('maps each of the 8 place types to its path', () => {
    expect(url('', { type: 'city', name: 'Alexandria', address: ALEXANDRIA })).toBe(
      '/alexandria-va/homes-for-sale',
    );
    expect(
      url('', {
        type: 'village',
        name: 'Kensington',
        address: { village: 'Kensington', state: 'Maryland' },
      }),
    ).toBe('/kensington-md/homes-for-sale');
    expect(
      url('', {
        type: 'administrative',
        addresstype: 'township',
        name: 'Lower Merion Township',
        address: { township: 'Lower Merion Township', state: 'Pennsylvania' },
      }),
    ).toBe('/lower-merion-township-pa/homes-for-sale');
    expect(url('', { type: 'postcode', address: { ...ALEXANDRIA, postcode: '22314' } })).toBe(
      '/alexandria-va/22314/homes-for-sale',
    );
    expect(
      url('', { type: 'suburb', name: 'Del Ray', address: { ...ALEXANDRIA, suburb: 'Del Ray' } }),
    ).toBe('/alexandria-va/del-ray-neighborhood/homes-for-sale');
    expect(url('', { type: 'road', address: { ...ALEXANDRIA, road: 'King Street' } })).toBe(
      '/alexandria-va/king-st/homes-for-sale',
    );
    expect(
      url('', {
        type: 'county',
        name: 'Fairfax County',
        address: { county: 'Fairfax County', state: 'Virginia' },
      }),
    ).toBe('/fairfax-county-va/homes-for-sale');
    expect(
      url('', {
        type: 'house',
        address: { ...ALEXANDRIA, house_number: '118', road: 'Baggett Place' },
      }),
    ).toBe('/alexandria-va/118-baggett-place-alexandria-va');
  });

  it('refuses a street or neighborhood with no city parent', () => {
    expect(
      searchTargetFor('', { type: 'road', address: { road: 'Main Street', state: 'Virginia' } }),
    ).toBeNull();
    expect(
      searchTargetFor('', { type: 'suburb', name: 'Del Ray', address: { state: 'Virginia' } }),
    ).toBeNull();
    expect(
      searchableSuggestions([
        { type: 'road', address: { road: 'Main Street', state: 'Virginia' } },
        { type: 'city', name: 'Alexandria', address: ALEXANDRIA },
      ]),
    ).toHaveLength(1);
  });

  it('carries the listing type in the segment, and only all/sold in the query', () => {
    const loc = { type: 'city', name: 'Alexandria', address: ALEXANDRIA };
    expect(url('', loc, 'rent')).toBe('/alexandria-va/homes-for-rent');
    expect(url('', loc, 'all')).toBe('/alexandria-va/homes-for-sale?type=all');
    // The search bar defaults to "All listings" until the visitor picks a type.
    const defaultType = searchReducer(undefined, { type: '@@init' }).searchListingType;
    expect(defaultType).toBe('all');
    expect(url('', loc, defaultType)).toBe('/alexandria-va/homes-for-sale?type=all');
    expect(listingTypeForPath('homes-for-rent', null)).toEqual({
      listingType: 'rent',
      override: null,
    });
    expect(listingTypeForPath('homes-for-sale', 'all')).toEqual({
      listingType: undefined,
      override: 'all',
    });
  });
});

describe('legacySearchUrl (#350)', () => {
  it('sends a city search to its place path and keeps the filters', () => {
    const params = new URLSearchParams(
      'q=Alexandria%2C+VA&city=Alexandria&state=VA&type=rent&beds=2',
    );
    expect(legacySearchUrl(params)).toBe('/alexandria-va/homes-for-rent?beds=2');
  });

  it('sends a neighborhood search to its place path', () => {
    const params = new URLSearchParams('neighborhood=Del+Ray&city=Alexandria&state=VA&type=sale');
    expect(legacySearchUrl(params)).toBe('/alexandria-va/del-ray-neighborhood/homes-for-sale');
  });

  it('keeps anything else on the map-area path', () => {
    expect(legacySearchUrl(new URLSearchParams('zip=22314'))).toBe(
      '/homes-for-sale?zip=22314&type=all',
    );
    expect(legacySearchUrl(new URLSearchParams(''))).toBe('/homes-for-sale?type=all');
  });
});

describe('boundsToBoundary', () => {
  it('turns n,e,s,w into a closed polygon, and refuses a bad rectangle', () => {
    expect(JSON.parse(boundsToBoundary('39,-77,38,-78') as string)).toEqual({
      type: 'Polygon',
      coordinates: [
        [
          [-78, 39],
          [-77, 39],
          [-77, 38],
          [-78, 38],
          [-78, 39],
        ],
      ],
    });
    expect(boundsToBoundary('38,-77,39,-78')).toBeUndefined();
    expect(boundsToBoundary('x')).toBeUndefined();
  });
});
