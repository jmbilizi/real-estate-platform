import {
  isAddressSegment,
  normalizeStreetLine,
  parsePropertyPath,
  parseSearchPath,
  propertyPagePath,
  propertyPath,
  propertySlug,
  SEARCH_PATH_SEGMENTS,
  searchPath,
  type SearchPlace,
  slugify,
  streetLineOf,
} from './address-slug';
import { propertyPageSchema } from './property-page';

const PARTS = {
  streetLine: '118 Baggett Place',
  unitNumber: null,
  city: 'Alexandria',
  state: 'VA',
  zip: '22314',
};

describe('propertyPath (#349)', () => {
  it('builds the short form, the unit form and the ZIP form', () => {
    expect(propertyPath(PARTS, { withZip: false })).toBe(
      '/alexandria-va/118-baggett-place-alexandria-va',
    );
    expect(propertyPath({ ...PARTS, unitNumber: '2' }, { withZip: false })).toBe(
      '/alexandria-va/118-baggett-place-unit-2-alexandria-va',
    );
    expect(propertyPath(PARTS, { withZip: true })).toBe(
      '/alexandria-va/118-baggett-place-alexandria-va-22314',
    );
  });

  it('round-trips through parsePropertyPath', () => {
    for (const parts of [PARTS, { ...PARTS, unitNumber: '4B' }]) {
      for (const withZip of [false, true]) {
        const [, city, address] = propertyPath(parts, { withZip }).split('/');
        const parsed = parsePropertyPath(city ?? '', address ?? '');
        expect(parsed).toMatchObject({
          houseNumber: '118',
          streetLine: '118 baggett place',
          unitNumber: parts.unitNumber === null ? null : parts.unitNumber.toLowerCase(),
          city: 'alexandria',
          state: 'VA',
          zip: withZip ? '22314' : null,
        });
      }
    }
  });

  it('parses a multi-word city', () => {
    expect(parsePropertyPath('silver-spring-md', '8-n-main-st-silver-spring-md')).toMatchObject({
      street: 'n main st',
      city: 'silver spring',
      state: 'MD',
    });
  });
});

describe('the shared path rule', () => {
  it('reads a leading house number as an address, and search segments as not', () => {
    expect(isAddressSegment('118-baggett-place-alexandria-va')).toBe(true);
    for (const segment of SEARCH_PATH_SEGMENTS) expect(isAddressSegment(segment)).toBe(false);
  });

  it('rejects segments that do not form a property path', () => {
    expect(parsePropertyPath('alexandria-va', 'homes-for-sale')).toBeNull();
    expect(parsePropertyPath('alexandria', '118-baggett-place-alexandria')).toBeNull();
    expect(parsePropertyPath('alexandria-va', '118-baggett-place-arlington-va')).toBeNull();
    expect(parsePropertyPath('alexandria-va', '118-alexandria-va')).toBeNull();
  });
});

describe('normalizeStreetLine', () => {
  it('matches Place and Pl, and directionals', () => {
    expect(normalizeStreetLine('118 Baggett Place')).toBe(normalizeStreetLine('118 baggett pl.'));
    expect(normalizeStreetLine('800 F Street Northwest')).toBe('800 f st nw');
  });
});

describe('propertyPageSchema', () => {
  const record = {
    propertyId: '018f2f2a-6d1b-7c3d-8b2e-000000000002',
    address: '118 Baggett Pl',
    unitNumber: null,
    city: 'Alexandria',
    state: 'VA',
    zip: '22314',
    propertyType: 'Townhome',
    beds: 3,
    baths: 2.5,
    sqft: null,
    lotSqft: null,
    yearBuilt: null,
    source: 'brightMLS',
    isSample: false,
  };
  const base = {
    propertyId: record.propertyId,
    listingId: '018f2f2a-6d1b-7c3d-8b2e-000000000001',
    slug: '118-baggett-pl-alexandria-va',
    canonicalPath: '/property/118-baggett-pl-alexandria-va/' + record.propertyId,
    seo: { title: '118 Baggett Pl, Alexandria, VA 22314', description: 'Facts.' },
    propertyRecord: record,
    latestListing: null,
    history: [],
    nearby: [],
  };

  it('accepts Off market with no latest listing', () => {
    expect(
      propertyPageSchema.safeParse({
        ...base,
        marketStatus: 'Off market',
        listingDataDisplayable: false,
      }).success,
    ).toBe(true);
  });

  it('refuses a displayable status with no listing, and Off market marked displayable', () => {
    expect(
      propertyPageSchema.safeParse({
        ...base,
        marketStatus: 'Active',
        listingDataDisplayable: true,
      }).success,
    ).toBe(false);
    expect(
      propertyPageSchema.safeParse({
        ...base,
        marketStatus: 'Off market',
        listingDataDisplayable: true,
      }).success,
    ).toBe(false);
  });
});

describe('propertySlug / propertyPagePath (#382)', () => {
  const id = '018f2f2a-6d1b-7c3d-8b2e-000000000002';

  it('puts the unit after the city, as the stakeholder example does', () => {
    expect(
      propertyPagePath(
        { streetLine: '2123 California St NW', unitNumber: 'A4', city: 'Washington', state: 'DC' },
        id,
      ),
    ).toBe('/property/2123-california-st-nw-washington-dc-unit-a4/' + id);
  });

  it('drops a unit keyword so that the slug does not say unit twice', () => {
    expect(
      propertySlug({ streetLine: '1 Main St', unitNumber: 'Apt #2B', city: 'Reston', state: 'VA' }),
    ).toBe('1-main-st-reston-va-unit-2b');
  });

  it('gives the city segment only when the seller withheld the address', () => {
    expect(
      propertySlug({ streetLine: null, unitNumber: null, city: 'Silver Spring', state: 'MD' }),
    ).toBe('silver-spring-md');
  });

  it('splits a display address back into its street line', () => {
    expect(streetLineOf('2123 California St NW A4', 'A4')).toBe('2123 California St NW');
    expect(streetLineOf('118 Baggett Pl', null)).toBe('118 Baggett Pl');
  });
});

describe('searchPath / parseSearchPath (#350)', () => {
  const cases: Array<[SearchPlace | null, string]> = [
    [{ kind: 'city', city: 'Alexandria', state: 'VA' }, '/alexandria-va/homes-for-sale'],
    [{ kind: 'city', city: 'Winston-Salem', state: 'NC' }, '/winston-salem-nc/homes-for-sale'],
    [
      { kind: 'zip', zip: '22314', city: 'Alexandria', state: 'VA' },
      '/alexandria-va/22314/homes-for-sale',
    ],
    [
      { kind: 'neighborhood', name: 'Del Ray', city: 'Alexandria', state: 'VA' },
      '/alexandria-va/del-ray-neighborhood/homes-for-sale',
    ],
    [
      { kind: 'neighborhood', name: 'Del Ray', city: 'Alexandria', state: 'VA', zip: '22301' },
      '/alexandria-va/22301/del-ray-neighborhood/homes-for-sale',
    ],
    [
      { kind: 'street', name: 'King Street', city: 'Alexandria', state: 'VA' },
      '/alexandria-va/king-st/homes-for-sale',
    ],
    [
      { kind: 'street', name: 'Taylor Run Parkway', city: 'Alexandria', state: 'VA' },
      '/alexandria-va/taylor-run-pkwy/homes-for-sale',
    ],
    [
      { kind: 'street', name: 'West Braddock Road', city: 'Alexandria', state: 'VA', zip: '22302' },
      '/alexandria-va/22302/w-braddock-rd/homes-for-sale',
    ],
    [
      { kind: 'street', name: '1st Street', city: 'Laurel', state: 'MD' },
      '/laurel-md/1st-st/homes-for-sale',
    ],
    [
      { kind: 'county', county: 'Fairfax County', state: 'VA' },
      '/fairfax-county-va/homes-for-sale',
    ],
    [
      { kind: 'county', county: "Prince George's", state: 'MD' },
      '/prince-george-s-county-md/homes-for-sale',
    ],
    [null, '/homes-for-sale'],
  ];

  it.each(cases)('builds and round-trips %j', (place, path) => {
    expect(searchPath(place, 'homes-for-sale')).toBe(path);
    const parsed = parseSearchPath(path.split('/'));
    expect(parsed?.segment).toBe('homes-for-sale');
    expect(searchPath(parsed?.place ?? null, 'homes-for-sale')).toBe(path);
  });

  it('parses names back to lower-case words', () => {
    expect(parseSearchPath(['alexandria-va', 'del-ray-neighborhood', 'homes-for-rent'])).toEqual({
      place: { kind: 'neighborhood', name: 'del ray', city: 'alexandria', state: 'VA', zip: null },
      segment: 'homes-for-rent',
    });
    expect(parseSearchPath(['fairfax-county-va', 'homes-for-sale'])?.place).toEqual({
      kind: 'county',
      county: 'fairfax',
      state: 'VA',
    });
  });

  it('refuses shapes that are not search paths', () => {
    expect(parseSearchPath(['alexandria-va', '118-baggett-place-alexandria-va'])).toBeNull();
    expect(parseSearchPath(['alexandria-va', 'homes'])).toBeNull();
    expect(parseSearchPath(['alexandria', 'homes-for-sale'])).toBeNull();
    expect(parseSearchPath(['alexandria-va', 'a-st', 'b-st', 'homes-for-sale'])).toBeNull();
    expect(parseSearchPath(['alexandria-va', '22314', '22301', 'homes-for-sale'])).toBeNull();
  });

  it('reads the second segment as ZIP, neighborhood, or else street', () => {
    const second = (segment: string) =>
      parseSearchPath(['alexandria-va', segment, 'homes-for-sale'])?.place?.kind;
    expect(second('22314')).toBe('zip');
    expect(second('del-ray-neighborhood')).toBe('neighborhood');
    expect(second('king-st')).toBe('street');
    expect(parseSearchPath(['alexandria-va', 'king-st', 'homes-for-sale'])?.place).toMatchObject({
      name: 'king st',
    });
  });

  /**
   * #393: a Bright neighborhood name can carry punctuation and doubled spaces
   * ("O'Fallon Park", "Foggy Bottom / West End"). `slugify` must fold a name to the same slug the
   * path carries, and folding what `parseSearchPath` hands back must reproduce that same slug —
   * otherwise our own data lookup, keyed on the slug, would miss a neighborhood whose path resolves
   * to it.
   */
  it.each([
    'Columbia Heights',
    "O'Fallon Park",
    'Foggy Bottom / West End',
    'St.  Elmo   Village',
    'Mount  Pleasant,  NW',
  ])('keeps the slug stable through searchPath -> parseSearchPath for %j', (name) => {
    const path = searchPath(
      { kind: 'neighborhood', name, city: 'Washington', state: 'DC' },
      'homes-for-sale',
    );
    const parsed = parseSearchPath(path.split('/'));
    expect(parsed?.place?.kind).toBe('neighborhood');
    const roundTripped = parsed?.place?.kind === 'neighborhood' ? parsed.place.name : '';
    expect(slugify(roundTripped)).toBe(slugify(name));
  });
});
