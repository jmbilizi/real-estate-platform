import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { LISTING_TYPES } from '@cribstop/property-contracts';
import { SearchDateRange, SearchSuggestion } from '@/lib/store/types';

/** The search bar's own Listing Type filter — the contract's enum plus `'all'`, its default. */
export type SearchListingType = (typeof LISTING_TYPES)[number] | 'all';

/**
 * There is deliberately no occupancy field here (#34). The removed "Who" picker collected age
 * bands, a children/infants count and a "service animal" flag — familial status, age, family
 * responsibilities and disability. Nothing about the searcher's household belongs in search state,
 * and nothing may ever be transmitted, logged, persisted, put in analytics or ranked on. Keeping
 * the shape free of it makes that structural rather than a convention to remember. Asserted by
 * `searchSlice.spec.ts`.
 *
 * There is also deliberately no free-text description/keyword field (#244). `description` is
 * third-party MLS remarks carrying a moderation state; making it searchable turns phrases like
 * "great for families" into a matchable term (PRD §6.3). The `amenities` filter is the safe
 * equivalent for the "keyword" shopping use case (pool, garage, waterfront).
 */
interface SearchState {
  searchLocation: string;
  searchSuggestion: SearchSuggestion;
  searchMoveInDate: string;
  searchDateRange: SearchDateRange;
  searchPriceIdx: number;
  searchListingType: SearchListingType;
}

const initialState: SearchState = {
  searchLocation: '',
  searchSuggestion: null,
  searchMoveInDate: '',
  searchDateRange: { start: '', end: '', flexibility: 'exact' },
  searchPriceIdx: 0,
  searchListingType: 'all',
};

const searchSlice = createSlice({
  name: 'search',
  initialState,
  reducers: {
    setSearchLocation: (state, action: PayloadAction<string>) => {
      state.searchLocation = action.payload;
    },
    setSearchSuggestion: (state, action: PayloadAction<SearchSuggestion>) => {
      state.searchSuggestion = action.payload;
    },
    setSearchMoveInDate: (state, action: PayloadAction<string>) => {
      state.searchMoveInDate = action.payload;
    },
    setSearchDateRange: (state, action: PayloadAction<SearchDateRange>) => {
      state.searchDateRange = action.payload;
    },
    setSearchPriceIdx: (state, action: PayloadAction<number>) => {
      state.searchPriceIdx = action.payload;
    },
    setSearchListingType: (state, action: PayloadAction<SearchListingType>) => {
      state.searchListingType = action.payload;
    },
  },
});

export const {
  setSearchLocation,
  setSearchSuggestion,
  setSearchMoveInDate,
  setSearchDateRange,
  setSearchPriceIdx,
  setSearchListingType,
} = searchSlice.actions;
export default searchSlice.reducer;
