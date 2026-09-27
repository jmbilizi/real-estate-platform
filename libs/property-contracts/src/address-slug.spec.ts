import {
  isAddressSegment,
  normalizeStreetLine,
  parsePropertyPath,
  propertyPath,
  SEARCH_PATH_SEGMENTS,
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
