import { buildAddressKey, normalizeStreetLine, splitUnitDesignator } from './address';

describe('splitUnitDesignator', () => {
  it.each([
    ['800 F St NW Unit 1201', '800 F St NW', '1201'],
    ['1330 Kenyon St NW Apt 4', '1330 Kenyon St NW', '4'],
    ['1000 Fell St Loft 3B', '1000 Fell St', '3B'],
    ['501 Slaters Ln PH1', '501 Slaters Ln', 'PH1'],
    ['12 Main St #202', '12 Main St', '202'],
    ['400 King St Suite B', '400 King St', 'B'],
  ])('splits %s into street line and unit', (address, streetLine, unitNumber) => {
    expect(splitUnitDesignator(address)).toEqual({ streetLine, unitNumber });
  });

  it.each([
    ['1200 Harbor View Dr'],
    ['234 Warren Ave'],
    ['7801 Old Georgetown Rd'],
    ['512 E Capitol St SE'],
  ])('returns a null unit for %s (no subdivision)', (address) => {
    expect(splitUnitDesignator(address)).toEqual({ streetLine: address, unitNumber: null });
  });

  it('does not mistake a directional suffix for a unit designator', () => {
    // 'SE' must not be read as a unit; that would put the same building under two address keys.
    expect(splitUnitDesignator('512 E Capitol St SE').unitNumber).toBeNull();
  });
});

describe('normalizeStreetLine', () => {
  it('canonicalises USPS street suffixes so abbreviations and full words agree', () => {
    // The whole point of the key: these are the same building arriving from two sources.
    expect(normalizeStreetLine('800 F Street NW')).toBe(normalizeStreetLine('800 F St NW'));
  });

  it('canonicalises directionals', () => {
    expect(normalizeStreetLine('512 East Capitol St Southeast')).toBe(
      normalizeStreetLine('512 E Capitol St SE'),
    );
  });

  it('is case- and punctuation-insensitive and collapses whitespace', () => {
    expect(normalizeStreetLine('1200  Harbor View Dr.')).toBe(
      normalizeStreetLine('1200 HARBOR VIEW DR'),
    );
  });

  it('leaves distinct streets distinct', () => {
    expect(normalizeStreetLine('800 F St NW')).not.toBe(normalizeStreetLine('800 G St NW'));
  });
});

describe('buildAddressKey', () => {
  it('collapses equivalent spellings of one building to one key', () => {
    const a = buildAddressKey({ streetLine: '800 F Street NW', state: 'DC', zip5: '20004' });
    const b = buildAddressKey({ streetLine: '800 F St NW', state: 'dc', zip5: '20004' });
    expect(a).toBe(b);
  });

  it('separates the same street line in different states', () => {
    // The platform must stay market-agnostic, so state is part of the identity.
    const md = buildAddressKey({ streetLine: '100 Main St', state: 'MD', zip5: '21201' });
    const va = buildAddressKey({ streetLine: '100 Main St', state: 'VA', zip5: '21201' });
    expect(md).not.toBe(va);
  });

  it('truncates ZIP+4 to the 5-digit ZIP', () => {
    const short = buildAddressKey({ streetLine: '100 Main St', state: 'MD', zip5: '21201' });
    const long = buildAddressKey({ streetLine: '100 Main St', state: 'MD', zip5: '21201-1234' });
    expect(short).toBe(long);
  });
});
