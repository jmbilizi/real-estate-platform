import { bareZip, extractSearchTerms } from './search-utils';

describe('bareZip', () => {
  it('accepts an exact 5-digit value', () => {
    expect(bareZip('20850')).toBe('20850');
  });

  it('trims surrounding whitespace', () => {
    expect(bareZip('  20850  ')).toBe('20850');
  });

  it('rejects anything that is not exactly 5 digits', () => {
    expect(bareZip('2085')).toBeUndefined();
    expect(bareZip('208501')).toBeUndefined();
    expect(bareZip('Rockville, MD')).toBeUndefined();
    expect(bareZip('20850-1234')).toBeUndefined();
    expect(bareZip('')).toBeUndefined();
  });
});

describe('extractSearchTerms', () => {
  it('returns only zip for a picked postcode suggestion', () => {
    const suggestion = { type: 'postcode', address: { postcode: '20850' } };
    expect(extractSearchTerms(suggestion)).toEqual({ zip: '20850' });
  });

  it('returns only street for a picked road suggestion', () => {
    const suggestion = { type: 'road', address: { road: 'Slaters Ln' } };
    expect(extractSearchTerms(suggestion)).toEqual({ street: 'Slaters Ln' });
  });

  it('includes the house number for a picked house suggestion', () => {
    const suggestion = { type: 'house', address: { house_number: '501', road: 'Slaters Ln' } };
    expect(extractSearchTerms(suggestion)).toEqual({ street: '501 Slaters Ln' });
  });

  it('returns city and state for a picked city suggestion, using the state code', () => {
    const suggestion = { type: 'city', address: { city: 'Rockville', state_code: 'MD' } };
    expect(extractSearchTerms(suggestion)).toEqual({ city: 'Rockville', state: 'MD' });
  });

  it('abbreviates a full state name for a town suggestion', () => {
    const suggestion = { type: 'town', address: { town: 'Frederick', state: 'Maryland' } };
    expect(extractSearchTerms(suggestion)).toEqual({ city: 'Frederick', state: 'MD' });
  });

  it('reads village the same way', () => {
    const suggestion = { type: 'village', address: { village: 'Chevy Chase', state_code: 'MD' } };
    expect(extractSearchTerms(suggestion)).toEqual({ city: 'Chevy Chase', state: 'MD' });
  });

  it('returns nothing for a suggestion type with no routing rule', () => {
    expect(extractSearchTerms({ type: 'country', address: {} })).toEqual({});
  });

  it('never returns more than one shape', () => {
    // A malformed suggestion could carry both a postcode and a road; postcode still wins alone.
    const suggestion = {
      type: 'postcode',
      address: { postcode: '20850', road: 'Slaters Ln', city: 'Rockville', state_code: 'MD' },
    };
    expect(extractSearchTerms(suggestion)).toEqual({ zip: '20850' });
  });
});
