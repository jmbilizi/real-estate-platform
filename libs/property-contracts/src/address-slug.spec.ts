import {
  isAddressSegment,
  normalizeStreetLine,
  parsePropertyPath,
  parseSearchPath,
  propertyPath,
  SEARCH_PATH_SEGMENTS,
  searchPath,
  type SearchPlace,
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
    listingId: '018f2f2a-6d1b-7c3d-8b2e-000000000001',
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

  it('accepts Off market with no detail', () => {
    expect(
      propertyPageSchema.safeParse({
        marketStatus: 'Off market',
        listingDataDisplayable: false,
        path: null,
        propertyRecord: record,
        detail: null,
      }).success,
    ).toBe(true);
  });

  it('refuses a displayable status with no detail, and Off market marked displayable', () => {
    const base = { path: null, propertyRecord: record, detail: null };
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
      '/alexandria-va/king-street-street/homes-for-sale',
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
    expect(parseSearchPath(['alexandria-va', 'del-ray', 'homes-for-sale'])).toBeNull();
    expect(parseSearchPath(['alexandria-va', 'a-street', 'b-street', 'homes-for-sale'])).toBeNull();
  });
});
