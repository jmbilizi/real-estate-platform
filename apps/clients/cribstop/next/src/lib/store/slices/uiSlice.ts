import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { ListingTab, ListingType, NavTab } from '@/lib/store/types';

interface UiState {
  listingTab: ListingTab;
  activeTab: NavTab;
  listingType: ListingType;
  showHeaderPill: boolean;
  headerExpanded: boolean;
  mobileSearchOpen: boolean;
}

const initialState: UiState = {
  listingTab: 'for-sale',
  activeTab: 'homes',
  listingType: 'sale',
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
      // Keep listingType in sync with legacy listingTab
      state.listingType = action.payload === 'for-rent' ? 'rent' : 'sale';
    },
    setActiveTab: (state, action: PayloadAction<NavTab>) => {
      state.activeTab = action.payload;
    },
    setListingType: (state, action: PayloadAction<ListingType>) => {
      state.listingType = action.payload;
      // Keep legacy listingTab in sync
      state.listingTab = action.payload === 'rent' ? 'for-rent' : 'for-sale';
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

export const {
  setListingTab,
  setActiveTab,
  setListingType,
  setShowHeaderPill,
  setHeaderExpanded,
  setMobileSearchOpen,
} = uiSlice.actions;
export default uiSlice.reducer;
