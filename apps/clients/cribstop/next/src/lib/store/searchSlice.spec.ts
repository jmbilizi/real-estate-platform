import searchReducer, * as searchActions from '@/lib/store/slices/searchSlice';
import { SEARCH_PANELS, type SearchPanel } from '@/lib/store/types';

/**
 * The occupancy vocabulary the removed "Who" picker used (#34). Asserted BY NAME rather than only
 * by the absence of a panel, so a future reintroduction fails a named, explained test instead of
 * slipping through: `seniors`/`adults`/`teens` are age bands, `children`/`infants` are a familial
 * status proxy, and the `pets` counter was labelled "Bringing a service animal?" — a disability
 * signal. On a housing search that is four protected classes (age, familial status, family
 * responsibilities, disability) collected at the top of the funnel.
 *
 * The recorded stakeholder decision (#34, 2026-08-13) is Option 1: removed entirely, and no
 * occupancy value may ever be transmitted to a service, logged, persisted, put in analytics, or
 * used in ranking. If this test fails, do not adjust it — remove whatever reintroduced the field.
 */
const OCCUPANCY_KEYS = ['seniors', 'adults', 'teens', 'children', 'infants', 'pets', 'occupants'];

const initialSearchState = searchReducer(undefined, { type: '@@INIT/searchSlice.spec' });

describe('search slice carries no occupancy state (#34)', () => {
  it('has no occupancy key in its initial state', () => {
    const offenders = Object.keys(initialSearchState).filter((key) =>
      OCCUPANCY_KEYS.some((banned) => key.toLowerCase().includes(banned)),
    );

    expect(offenders).toEqual([]);
  });

  it('enumerates exactly the search fields the bar still collects', () => {
    expect(Object.keys(initialSearchState).sort()).toEqual([
      'searchDateRange',
      'searchDescription',
      'searchListingType',
      'searchLocation',
      'searchMoveInDate',
      'searchPriceIdx',
      'searchSuggestion',
    ]);
  });

  it('exposes no action that could write an occupancy value', () => {
    const offenders = Object.keys(searchActions).filter((name) =>
      OCCUPANCY_KEYS.some((banned) => name.toLowerCase().includes(banned)),
    );

    expect(offenders).toEqual([]);
  });
});

describe("the search bar has no 'who' panel (#34)", () => {
  it('enumerates only the three surviving segments', () => {
    expect([...SEARCH_PANELS]).toEqual(['where', 'when', 'what']);
  });

  it("cannot name 'who' as a panel", () => {
    expect(SEARCH_PANELS).not.toContain('who');

    // Type-level half of the same assertion: `activePanel`, `openFromPill` and the mobile sheet's
    // panel-cycling chain are all typed `SearchPanel`, so no keyboard path, focus path, panel
    // transition or URL/state restore can target the removed segment without failing to compile.
    // If the @ts-expect-error below ever goes unused, `'who'` has become assignable again.
    // @ts-expect-error 'who' is deliberately absent from the SearchPanel union (#34).
    const reintroduced: SearchPanel = 'who';
    expect(reintroduced).toBe('who');
  });
});

// The Lot/Land interlock's own coverage moved to `lib/listing-filters.spec.ts` (`isLandOnly`,
// `applyLandInterlock`) when #243 removed the search bar's property-type selection — the
// array-based `isParcelOnlySelection` that lived here had no caller left afterward.
