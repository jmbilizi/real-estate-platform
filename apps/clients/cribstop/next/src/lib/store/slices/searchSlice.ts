import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { SearchDateRange, SearchSuggestion } from '@/lib/store/types';

/**
 * There is deliberately no occupancy field here (#34). The removed "Who" picker collected age
 * bands, a children/infants count and a "service animal" flag — familial status, age, family
 * responsibilities and disability. Nothing about the searcher's household belongs in search state,
 * and nothing may ever be transmitted, logged, persisted, put in analytics or ranked on. Keeping
 * the shape free of it makes that structural rather than a convention to remember. Asserted by
 * `searchSlice.spec.ts`.
 */
interface SearchState {
  searchLocation: string;
  searchSuggestion: SearchSuggestion;
  searchMoveInDate: string;
  searchDateRange: SearchDateRange;
  searchPriceIdx: number;
  searchBedsIdx: number;
  searchPropertyTypes: string[];
  searchBaths: string;
  searchMaxPrice: number;
  searchDescription: string;
}

const initialState: SearchState = {
  searchLocation: '',
  searchSuggestion: null,
  searchMoveInDate: '',
  searchDateRange: { start: '', end: '', flexibility: 'exact' },
  searchPriceIdx: 0,
  searchBedsIdx: 0,
  searchPropertyTypes: [],
  searchBaths: '',
  searchMaxPrice: 0,
  searchDescription: '',
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
    setSearchBedsIdx: (state, action: PayloadAction<number>) => {
      state.searchBedsIdx = action.payload;
    },
    setSearchPropertyTypes: (state, action: PayloadAction<string[]>) => {
      state.searchPropertyTypes = action.payload;
    },
    setSearchBaths: (state, action: PayloadAction<string>) => {
      state.searchBaths = action.payload;
    },
    setSearchMaxPrice: (state, action: PayloadAction<number>) => {
      state.searchMaxPrice = action.payload;
    },
    setSearchDescription: (state, action: PayloadAction<string>) => {
      state.searchDescription = action.payload;
    },
  },
});

export const {
  setSearchLocation,
  setSearchSuggestion,
  setSearchMoveInDate,
  setSearchDateRange,
  setSearchPriceIdx,
  setSearchBedsIdx,
  setSearchPropertyTypes,
  setSearchBaths,
  setSearchMaxPrice,
  setSearchDescription,
} = searchSlice.actions;
export default searchSlice.reducer;
