import { countActiveFilters } from './FilterModal';

/**
 * #347: a location picked in the search bar must never inflate the Filters button's badge — only
 * a choice made in the filter panel counts. Every location field the search bar can set is
 * asserted here, individually and combined, so a future field added to either surface cannot
 * silently start counting without this failing.
 */
describe('countActiveFilters', () => {
  it('does not count any location field the search bar sets', () => {
    expect(
      countActiveFilters({
        query: 'Bethesda, MD',
        zip: '20814',
        street: '100 Main St',
        city: 'Bethesda',
        state: 'MD',
        neighborhood: 'Downtown',
        boundary: '{"type":"Polygon","coordinates":[]}',
        sort: 'price-asc',
      }),
    ).toBe(0);
  });

  it('counts a real filter-panel narrowing normally', () => {
    expect(countActiveFilters({ propertyType: ['Condo'] })).toBe(1);
    expect(countActiveFilters({ beds: 2 })).toBe(1);
  });

  it('counts status only once it diverges from the contract default', () => {
    // The modal never sets `status` back to `['Active', 'Coming Soon']` explicitly — see
    // `FilterModalContent`'s `toggleStatus` — so any present `status` is a real narrowing.
    expect(countActiveFilters({ status: ['Pending'] })).toBe(1);
    expect(countActiveFilters({})).toBe(0);
  });

  it('combines a location and a real filter without double-counting the location', () => {
    expect(countActiveFilters({ city: 'Bethesda', state: 'MD', beds: 2 })).toBe(1);
  });
});
