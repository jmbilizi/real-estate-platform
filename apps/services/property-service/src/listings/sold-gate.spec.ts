import { visibleListingTypesFor } from './sold-gate';

describe('visibleListingTypesFor', () => {
  it('treats `all` as the shopping surface: sale + rent, never sold', () => {
    expect(visibleListingTypesFor('all')).toEqual(['sale', 'rent']);
  });

  it('returns sold only when sold was asked for explicitly', () => {
    expect(visibleListingTypesFor('sold')).toEqual(['sold']);
    expect(visibleListingTypesFor('sale')).toEqual(['sale']);
    expect(visibleListingTypesFor('rent')).toEqual(['rent']);
  });
});
