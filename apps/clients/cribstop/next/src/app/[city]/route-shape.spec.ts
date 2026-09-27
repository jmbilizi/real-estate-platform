import { isPropertyPath } from './route-shape';

describe('isPropertyPath (#349 / #350 boundary)', () => {
  it('is true for a city segment plus an address segment', () => {
    expect(isPropertyPath('alexandria-va', ['118-baggett-place-alexandria-va'])).toBe(true);
  });

  it('is true when the address segment carries a trailing ZIP', () => {
    expect(isPropertyPath('alexandria-va', ['118-baggett-place-alexandria-va-22301'])).toBe(true);
  });

  it('is false for a search segment (#350 owns these)', () => {
    expect(isPropertyPath('alexandria-va', ['homes-for-sale'])).toBe(false);
    expect(isPropertyPath('alexandria-va', ['homes-for-rent'])).toBe(false);
  });

  it('is false when the first segment is not a city segment', () => {
    expect(isPropertyPath('search', ['118-baggett-place-alexandria-va'])).toBe(false);
  });

  it('is false for more than two segments', () => {
    expect(isPropertyPath('alexandria-va', ['homes-for-sale', 'extra'])).toBe(false);
  });

  it('is false when the address segment is missing', () => {
    expect(isPropertyPath('alexandria-va', [])).toBe(false);
  });
});
