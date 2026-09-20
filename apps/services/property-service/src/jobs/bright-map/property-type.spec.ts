import { mapPropertyType } from './property-type';

describe('mapPropertyType', () => {
  it('maps a known RESO PropertySubType', () => {
    expect(mapPropertyType({ PropertySubType: 'Detached' })).toBe('Single Family');
    expect(mapPropertyType({ PropertySubType: 'Condominium' })).toBe('Condo');
    expect(mapPropertyType({ PropertySubType: 'Townhouse' })).toBe('Townhome');
    expect(mapPropertyType({ PropertySubType: 'Duplex' })).toBe('Multi-Family');
    expect(mapPropertyType({ PropertySubType: 'Land' })).toBe('Land');
  });

  it('fails closed on an unrecognised sub type', () => {
    expect(mapPropertyType({ PropertySubType: 'Mobile Home' })).toBeNull();
  });

  it('fails closed when the field is missing', () => {
    expect(mapPropertyType({})).toBeNull();
  });
});
