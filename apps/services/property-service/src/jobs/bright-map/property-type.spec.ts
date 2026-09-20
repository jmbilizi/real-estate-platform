import { mapPropertyType } from './property-type';

describe('mapPropertyType', () => {
  it('maps a known RESO PropertySubType', () => {
    expect(mapPropertyType({ PropertySubType: 'Detached' })).toBe('Single Family');
    expect(mapPropertyType({ PropertySubType: 'Condominium' })).toBe('Condo');
    expect(mapPropertyType({ PropertySubType: 'Townhouse' })).toBe('Townhome');
    expect(mapPropertyType({ PropertySubType: 'Duplex' })).toBe('Multi-Family');
    expect(mapPropertyType({ PropertySubType: 'Land' })).toBe('Land');
  });

  it('fails closed on an unrecognised sub type with no structure design type to fall back on', () => {
    expect(mapPropertyType({ PropertySubType: 'Mobile Home' })).toBeNull();
  });

  it('fails closed when the field is missing', () => {
    expect(mapPropertyType({})).toBeNull();
  });

  it('falls back to StructureDesignType when PropertySubType is blank (#207)', () => {
    expect(mapPropertyType({ StructureDesignType: 'Detached' })).toBe('Single Family');
    expect(mapPropertyType({ StructureDesignType: 'Twin/Semi-Detached' })).toBe('Single Family');
    expect(mapPropertyType({ StructureDesignType: 'End of Row/Townhouse' })).toBe('Townhome');
    expect(mapPropertyType({ StructureDesignType: 'Interior Row/Townhouse' })).toBe('Townhome');
    expect(mapPropertyType({ StructureDesignType: 'Unit/Flat/Apartment' })).toBe('Condo');
    expect(mapPropertyType({ StructureDesignType: 'Penthouse Unit/Flat/Apartment' })).toBe('Condo');
  });

  it('prefers PropertySubType over StructureDesignType when both are present', () => {
    expect(mapPropertyType({ PropertySubType: 'Land', StructureDesignType: 'Detached' })).toBe(
      'Land',
    );
  });

  it('maps a manufactured/mobile StructureDesignType (#226)', () => {
    expect(mapPropertyType({ StructureDesignType: 'Manufactured' })).toBe('Manufactured/Mobile');
    expect(mapPropertyType({ StructureDesignType: 'Mobile Pre 1976' })).toBe('Manufactured/Mobile');
  });

  it('fails closed on an unrecognised structure design type', () => {
    expect(mapPropertyType({ StructureDesignType: 'Other' })).toBeNull();
  });

  it('does not fall back to StructureDesignType when PropertySubType is present but unrecognised', () => {
    // Verified on the live feed (#216 code review): a commercial PropertySubType like 'Retail' can
    // co-occur with a StructureDesignType of 'Detached'. Falling through would misclassify a
    // commercial listing as 'Single Family' instead of leaving the explicit rejection in place.
    expect(
      mapPropertyType({ PropertySubType: 'Retail', StructureDesignType: 'Detached' }),
    ).toBeNull();
  });
});
