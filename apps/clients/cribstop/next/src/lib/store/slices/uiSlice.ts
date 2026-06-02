import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { ListingTab } from '@/lib/store/types';

interface UiState {
  listingTab: ListingTab;
  showHeaderPill: boolean;
  headerExpanded: boolean;
  mobileSearchOpen: boolean;
}

const initialState: UiState = {
  listingTab: 'for-sale',
  showHeaderPill: false,
  headerExpanded: false,
  mobileSearchOpen: false,
};

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setListingTab: (state, action: PayloadAction<ListingTab>) => {
      state.listingTab = action.payload;
    },
    setShowHeaderPill: (state, action: PayloadAction<boolean>) => {
      state.showHeaderPill = action.payload;
    },
    setHeaderExpanded: (state, action: PayloadAction<boolean>) => {
      state.headerExpanded = action.payload;
    },
    setMobileSearchOpen: (state, action: PayloadAction<boolean>) => {
      state.mobileSearchOpen = action.payload;
    },
  },
});

export const { setListingTab, setShowHeaderPill, setHeaderExpanded, setMobileSearchOpen } =
  uiSlice.actions;
export default uiSlice.reducer;
