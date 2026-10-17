import { listingKeys } from './keys';

describe('listingKeys', () => {
  it('nests every key under the domain root', () => {
    expect(listingKeys.detail('abc').slice(0, listingKeys.all.length)).toEqual(listingKeys.all);
  });

  it('gives a distinct key for each id', () => {
    expect(listingKeys.detail('a')).not.toEqual(listingKeys.detail('b'));
  });
});
