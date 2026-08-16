import {
  applyLandInterlock,
  isLandOnly,
  parseFiltersFromSearchParams,
  parsePageFromSearchParams,
} from './listing-filters';

describe('applyLandInterlock', () => {
  it('clears beds, baths and minimum square footage when Lot/Land is the only property type', () => {
    const cleared = applyLandInterlock({
      propertyType: 'Land',
      beds: 2,
      baths: 1,
      minSqft: 1200,
      minPrice: 100000,
    });

    expect(cleared.beds).toBeUndefined();
    expect(cleared.baths).toBeUndefined();
    expect(cleared.minSqft).toBeUndefined();
    // Filters that still mean something for a parcel are untouched.
    expect(cleared.minPrice).toBe(100000);
    expect(cleared.propertyType).toBe('Land');
  });

  it('leaves dwelling filters alone for any other property type', () => {
    const filters = { propertyType: 'Condo' as const, beds: 2, baths: 1, minSqft: 1200 };
    expect(applyLandInterlock(filters)).toEqual(filters);
  });

  it('leaves dwelling filters alone when no property type is selected', () => {
    const filters = { beds: 2, baths: 1 };
    expect(applyLandInterlock(filters)).toEqual(filters);
  });

  it('does not mutate the input', () => {
    const filters = { propertyType: 'Land' as const, beds: 2 };
    applyLandInterlock(filters);
    expect(filters.beds).toBe(2);
  });

  it('returns the same object when there is nothing to clear', () => {
    const filters = { propertyType: 'Land' as const, minPrice: 50000 };
    expect(applyLandInterlock(filters)).toBe(filters);
  });
});

describe('isLandOnly', () => {
  it('is true only for the Land property type', () => {
    expect(isLandOnly({ propertyType: 'Land' })).toBe(true);
    expect(isLandOnly({ propertyType: 'Condo' })).toBe(false);
    expect(isLandOnly({})).toBe(false);
  });
});

describe('parseFiltersFromSearchParams', () => {
  it('parses the contract parameters, keeping the q and type spellings the search bar builds', () => {
    const filters = parseFiltersFromSearchParams(
      new URLSearchParams(
        'q=Bethesda&type=rent&propertyType=Condo&minPrice=1500&maxPrice=3000&beds=2&baths=1.5&minSqft=900&neighborhood=Downtown&zip=20814&street=Main&sort=price-asc&openHouse=true&petFriendly=true',
      ),
    );

    expect(filters).toEqual({
      query: 'Bethesda',
      listingType: 'rent',
      propertyType: 'Condo',
      minPrice: 1500,
      maxPrice: 3000,
      beds: 2,
      baths: 1.5,
      minSqft: 900,
      neighborhood: 'Downtown',
      zip: '20814',
      street: 'Main',
      sort: 'price-asc',
      openHouse: true,
      petFriendly: true,
    });
  });

  it('collects repeated amenities', () => {
    const filters = parseFiltersFromSearchParams(
      new URLSearchParams('amenities=Pool&amenities=Garage'),
    );
    expect(filters.amenities).toEqual(['Pool', 'Garage']);
  });

  it('omits type=all so the API applies its own default, which excludes sold', () => {
    expect(
      parseFiltersFromSearchParams(new URLSearchParams('type=all')).listingType,
    ).toBeUndefined();
  });

  it('keeps an explicit sold search, which is the only way to reach sold inventory', () => {
    expect(parseFiltersFromSearchParams(new URLSearchParams('type=sold')).listingType).toBe('sold');
  });

  it('drops absent parameters entirely rather than carrying undefined keys', () => {
    expect(parseFiltersFromSearchParams(new URLSearchParams(''))).toEqual({});
    expect(Object.keys(parseFiltersFromSearchParams(new URLSearchParams('q=')))).toEqual([]);
  });

  it('ignores a non-numeric numeric parameter instead of sending NaN', () => {
    expect(
      parseFiltersFromSearchParams(new URLSearchParams('minPrice=abc')).minPrice,
    ).toBeUndefined();
  });

  it('treats a boolean flag as set only when it is literally true', () => {
    expect(
      parseFiltersFromSearchParams(new URLSearchParams('openHouse=false')).openHouse,
    ).toBeUndefined();
  });

  it('applies the Lot/Land interlock to a hand-edited URL, not just to chip clicks', () => {
    const filters = parseFiltersFromSearchParams(
      new URLSearchParams('propertyType=Land&beds=3&minSqft=2000'),
    );

    expect(filters.propertyType).toBe('Land');
    expect(filters.beds).toBeUndefined();
    expect(filters.minSqft).toBeUndefined();
  });

  describe('no occupancy value can survive a round trip through the URL', () => {
    it.each(['seniors', 'adults', 'teens', 'children', 'infants', 'pets', 'occupants'])(
      'drops %s',
      (key) => {
        const filters = parseFiltersFromSearchParams(new URLSearchParams(`q=Bethesda&${key}=2`));
        expect(filters).toEqual({ query: 'Bethesda' });
        expect(Object.keys(filters)).not.toContain(key);
      },
    );
  });
});

describe('parsePageFromSearchParams', () => {
  it('reads a valid page', () => {
    expect(parsePageFromSearchParams(new URLSearchParams('page=4'))).toBe(4);
  });

  it('floors at 1 so a hand-edited page=0 cannot produce a 400', () => {
    expect(parsePageFromSearchParams(new URLSearchParams('page=0'))).toBe(1);
    expect(parsePageFromSearchParams(new URLSearchParams('page=-3'))).toBe(1);
    expect(parsePageFromSearchParams(new URLSearchParams('page=abc'))).toBe(1);
    expect(parsePageFromSearchParams(new URLSearchParams('page=1.5'))).toBe(1);
    expect(parsePageFromSearchParams(new URLSearchParams(''))).toBe(1);
  });
});

describe('enum parameters are validated against the contract before being forwarded', () => {
  it('drops a comma-joined propertyType rather than sending a value the API rejects', () => {
    // The search bar used to emit this from multi-select checkboxes, and the old search page never
    // read the parameter at all — so it filtered nothing. Reading it makes a 400 reachable.
    const filters = parseFiltersFromSearchParams(
      new URLSearchParams('q=Bethesda&propertyType=Condo,Townhome'),
    );

    expect(filters.propertyType).toBeUndefined();
    expect(filters.query).toBe('Bethesda');
  });

  it('keeps a single valid propertyType', () => {
    expect(
      parseFiltersFromSearchParams(new URLSearchParams('propertyType=Townhome')).propertyType,
    ).toBe('Townhome');
  });

  it('drops a propertyType the contract does not define', () => {
    expect(
      parseFiltersFromSearchParams(new URLSearchParams('propertyType=Castle')).propertyType,
    ).toBeUndefined();
  });

  it('drops a listingType the contract does not define', () => {
    expect(
      parseFiltersFromSearchParams(new URLSearchParams('type=lease')).listingType,
    ).toBeUndefined();
  });

  it('drops a sort the contract does not define, so the dropdown cannot ask for one', () => {
    expect(parseFiltersFromSearchParams(new URLSearchParams('sort=distance')).sort).toBeUndefined();
    expect(parseFiltersFromSearchParams(new URLSearchParams('sort=newest')).sort).toBe('newest');
  });

  it('keeps only amenities in the closed set, and de-duplicates them', () => {
    const filters = parseFiltersFromSearchParams(
      new URLSearchParams('amenities=Pool&amenities=Helipad&amenities=Pool&amenities=Garage'),
    );
    expect(filters.amenities).toEqual(['Pool', 'Garage']);
  });

  it('accepts a comma-joined amenities list as well as repeated parameters', () => {
    expect(
      parseFiltersFromSearchParams(new URLSearchParams('amenities=Pool,Garage')).amenities,
    ).toEqual(['Pool', 'Garage']);
  });
});

describe('numeric parameters are validated against the contract string forms', () => {
  // The service parses these with `^\d+$` (and `^\d+(\.5)?$` for baths) inside a strict object, so
  // forwarding a merely-finite number manufactures a 400 that reads to the user as a broken API.
  it.each([
    ['minPrice', '1.5'],
    ['minPrice', '-500'],
    ['maxPrice', '1e6'],
    ['beds', '2.5'],
    ['minSqft', '-1'],
  ])('drops %s=%s rather than forwarding a value the API rejects', (key, value) => {
    const filters = parseFiltersFromSearchParams(new URLSearchParams(`${key}=${value}`));
    expect(filters[key as 'minPrice' | 'maxPrice' | 'beds' | 'minSqft']).toBeUndefined();
  });

  it('accepts whole numbers', () => {
    const filters = parseFiltersFromSearchParams(
      new URLSearchParams('minPrice=250000&maxPrice=900000&beds=3&minSqft=1200'),
    );
    expect(filters).toEqual({ minPrice: 250000, maxPrice: 900000, beds: 3, minSqft: 1200 });
  });

  it('accepts baths on a half step and rejects any other fraction', () => {
    expect(parseFiltersFromSearchParams(new URLSearchParams('baths=2')).baths).toBe(2);
    expect(parseFiltersFromSearchParams(new URLSearchParams('baths=2.5')).baths).toBe(2.5);
    expect(parseFiltersFromSearchParams(new URLSearchParams('baths=1.7')).baths).toBeUndefined();
    expect(parseFiltersFromSearchParams(new URLSearchParams('baths=2%2B')).baths).toBeUndefined();
  });
});

describe('the listing type reaches the API from every link the app builds', () => {
  it('reads the canonical type spelling', () => {
    expect(parseFiltersFromSearchParams(new URLSearchParams('type=sale')).listingType).toBe('sale');
  });

  it('accepts listingType as an alias, so bookmarked and in-app links still filter', () => {
    // "Homes for Sale" in the footer used this spelling; the parser read only `type`, so the link
    // produced an unfiltered search that silently mixed sale and rent inventory.
    expect(parseFiltersFromSearchParams(new URLSearchParams('listingType=rent')).listingType).toBe(
      'rent',
    );
  });

  it('prefers the canonical spelling when both are present', () => {
    expect(
      parseFiltersFromSearchParams(new URLSearchParams('type=sale&listingType=rent')).listingType,
    ).toBe('sale');
  });

  it('drops the search bar tab vocabulary, which is not a contract value', () => {
    // The bar now translates 'for-sale' -> 'sale' before building the URL; this guards the case
    // where an old bookmark still carries the tab identity.
    expect(
      parseFiltersFromSearchParams(new URLSearchParams('type=for-sale')).listingType,
    ).toBeUndefined();
  });
});
