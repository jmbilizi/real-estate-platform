import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { SearchDateRange, SearchOccupants, SearchSuggestion } from '@/lib/store/types';

interface SearchState {
  searchLocation: string;
  searchSuggestion: SearchSuggestion;
  searchMoveInDate: string;
  searchDateRange: SearchDateRange;
  searchOccupants: SearchOccupants;
  searchPriceIdx: number;
  searchBedsIdx: number;
}

const initialState: SearchState = {
  searchLocation: '',
  searchSuggestion: null,
  searchMoveInDate: '',
  searchDateRange: { start: '', end: '', flexibility: 'exact' },
  searchOccupants: {
    adults: 0,
    seniors: 0,
    teens: 0,
    children: 0,
    infants: 0,
    pets: 0,
  },
  searchPriceIdx: 0,
  searchBedsIdx: 0,
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
    setSearchOccupants: (state, action: PayloadAction<SearchOccupants>) => {
      state.searchOccupants = action.payload;
    },
    setSearchPriceIdx: (state, action: PayloadAction<number>) => {
      state.searchPriceIdx = action.payload;
    },
    setSearchBedsIdx: (state, action: PayloadAction<number>) => {
      state.searchBedsIdx = action.payload;
    },
  },
});

export const {
  setSearchLocation,
  setSearchSuggestion,
  setSearchMoveInDate,
  setSearchDateRange,
  setSearchOccupants,
  setSearchPriceIdx,
  setSearchBedsIdx,
} = searchSlice.actions;
export default searchSlice.reducer;
