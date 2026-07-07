import { RootState } from '@/lib/store/store';

export const selectUser = (state: RootState) => state.auth.user;
export const selectSessionChecked = (state: RootState) => state.auth.sessionChecked;
export const selectShowOnboarding = (state: RootState) => state.auth.showOnboarding;
export const selectSavedIds = (state: RootState) => state.favorites.savedIds;

export const selectListingTab = (state: RootState) => state.ui.listingTab;
export const selectActiveTab = (state: RootState) => state.ui.activeTab;
export const selectListingType = (state: RootState) => state.ui.listingType;
export const selectShowHeaderPill = (state: RootState) => state.ui.showHeaderPill;
export const selectHeaderExpanded = (state: RootState) => state.ui.headerExpanded;
export const selectMobileSearchOpen = (state: RootState) => state.ui.mobileSearchOpen;

export const selectSearchLocation = (state: RootState) => state.search.searchLocation;
export const selectSearchSuggestion = (state: RootState) => state.search.searchSuggestion;
export const selectSearchMoveInDate = (state: RootState) => state.search.searchMoveInDate;
export const selectSearchDateRange = (state: RootState) => state.search.searchDateRange;
export const selectSearchOccupants = (state: RootState) => state.search.searchOccupants;
export const selectSearchPriceIdx = (state: RootState) => state.search.searchPriceIdx;
export const selectSearchBedsIdx = (state: RootState) => state.search.searchBedsIdx;
