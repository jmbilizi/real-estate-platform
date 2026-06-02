'use client';

import React, { ReactNode, useCallback, useMemo } from 'react';
import { Provider } from 'react-redux';
import { useAppDispatch, useAppSelector } from '@/lib/store/hooks';
import { loginAccount, signupAccount } from '@/lib/api/account';
import {
  selectHeaderExpanded,
  selectListingTab,
  selectMobileSearchOpen,
  selectSavedIds,
  selectSearchBedsIdx,
  selectSearchDateRange,
  selectSearchLocation,
  selectSearchMoveInDate,
  selectSearchOccupants,
  selectSearchPriceIdx,
  selectSearchSuggestion,
  selectShowHeaderPill,
  selectUser,
} from '@/lib/store/selectors';
import { store } from '@/lib/store/store';
import { login, logout, signup } from '@/lib/store/slices/authSlice';
import { clearSaved, toggleSave } from '@/lib/store/slices/favoritesSlice';
import {
  setSearchBedsIdx,
  setSearchDateRange,
  setSearchLocation,
  setSearchMoveInDate,
  setSearchOccupants,
  setSearchPriceIdx,
  setSearchSuggestion,
} from '@/lib/store/slices/searchSlice';
import {
  setHeaderExpanded,
  setListingTab,
  setMobileSearchOpen,
  setShowHeaderPill,
} from '@/lib/store/slices/uiSlice';
import {
  ListingTab,
  SearchDateRange,
  SearchOccupants,
  SearchSuggestion,
  User,
} from '@/lib/store/types';

interface AppContextValue {
  user: User | null;
  savedIds: Set<string>;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, username: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  toggleSave: (id: string) => void;
  isSaved: (id: string) => boolean;
  listingTab: ListingTab;
  setListingTab: (tab: ListingTab) => void;
  showHeaderPill: boolean;
  setShowHeaderPill: (v: boolean) => void;
  headerExpanded: boolean;
  setHeaderExpanded: (v: boolean) => void;
  mobileSearchOpen: boolean;
  setMobileSearchOpen: (v: boolean) => void;
  searchLocation: string;
  setSearchLocation: (v: string) => void;
  searchSuggestion: SearchSuggestion;
  setSearchSuggestion: (v: SearchSuggestion) => void;
  searchMoveInDate: string;
  setSearchMoveInDate: (v: string) => void;
  searchDateRange: SearchDateRange;
  setSearchDateRange: (v: SearchDateRange) => void;
  searchOccupants: SearchOccupants;
  setSearchOccupants: (v: SearchOccupants) => void;
  searchPriceIdx: number;
  setSearchPriceIdx: (v: number) => void;
  searchBedsIdx: number;
  setSearchBedsIdx: (v: number) => void;
}

export function AppProvider({ children }: { children: ReactNode }) {
  return <Provider store={store}>{children}</Provider>;
}

export function useApp(): AppContextValue {
  const dispatch = useAppDispatch();

  const user = useAppSelector(selectUser);
  const savedIdList = useAppSelector(selectSavedIds);
  const listingTab = useAppSelector(selectListingTab);
  const showHeaderPill = useAppSelector(selectShowHeaderPill);
  const headerExpanded = useAppSelector(selectHeaderExpanded);
  const mobileSearchOpen = useAppSelector(selectMobileSearchOpen);
  const searchLocation = useAppSelector(selectSearchLocation);
  const searchSuggestion = useAppSelector(selectSearchSuggestion);
  const searchMoveInDate = useAppSelector(selectSearchMoveInDate);
  const searchDateRange = useAppSelector(selectSearchDateRange);
  const searchOccupants = useAppSelector(selectSearchOccupants);
  const searchPriceIdx = useAppSelector(selectSearchPriceIdx);
  const searchBedsIdx = useAppSelector(selectSearchBedsIdx);

  const savedIds = useMemo(() => new Set(savedIdList), [savedIdList]);

  const loginUser = useCallback(
    async (email: string, password: string) => {
      await loginAccount({ email, password });
      dispatch(login({ email }));
    },
    [dispatch],
  );

  const signupUser = useCallback(
    async (name: string, username: string, email: string, password: string) => {
      await signupAccount({ username, email, password });
      dispatch(signup({ name, email }));
    },
    [dispatch],
  );

  const logoutUser = useCallback(() => {
    dispatch(logout());
    dispatch(clearSaved());
  }, [dispatch]);

  const toggleSavedListing = useCallback(
    (id: string) => {
      dispatch(toggleSave(id));
    },
    [dispatch],
  );

  const isSaved = useCallback((id: string) => savedIds.has(id), [savedIds]);

  const setTab = useCallback(
    (tab: ListingTab) => {
      dispatch(setListingTab(tab));
    },
    [dispatch],
  );

  const setPill = useCallback(
    (v: boolean) => {
      dispatch(setShowHeaderPill(v));
    },
    [dispatch],
  );

  const setExpanded = useCallback(
    (v: boolean) => {
      dispatch(setHeaderExpanded(v));
    },
    [dispatch],
  );

  const setMobileOpen = useCallback(
    (v: boolean) => {
      dispatch(setMobileSearchOpen(v));
    },
    [dispatch],
  );

  const setLocation = useCallback(
    (v: string) => {
      dispatch(setSearchLocation(v));
    },
    [dispatch],
  );

  const setSuggestion = useCallback(
    (v: SearchSuggestion) => {
      dispatch(setSearchSuggestion(v));
    },
    [dispatch],
  );

  const setMoveInDate = useCallback(
    (v: string) => {
      dispatch(setSearchMoveInDate(v));
    },
    [dispatch],
  );

  const setDateRange = useCallback(
    (v: SearchDateRange) => {
      dispatch(setSearchDateRange(v));
    },
    [dispatch],
  );

  const setOccupants = useCallback(
    (v: SearchOccupants) => {
      dispatch(setSearchOccupants(v));
    },
    [dispatch],
  );

  const setPriceIdx = useCallback(
    (v: number) => {
      dispatch(setSearchPriceIdx(v));
    },
    [dispatch],
  );

  const setBedsIdx = useCallback(
    (v: number) => {
      dispatch(setSearchBedsIdx(v));
    },
    [dispatch],
  );

  return {
    user,
    savedIds,
    login: loginUser,
    signup: signupUser,
    logout: logoutUser,
    toggleSave: toggleSavedListing,
    isSaved,
    listingTab,
    setListingTab: setTab,
    showHeaderPill,
    setShowHeaderPill: setPill,
    headerExpanded,
    setHeaderExpanded: setExpanded,
    mobileSearchOpen,
    setMobileSearchOpen: setMobileOpen,
    searchLocation,
    setSearchLocation: setLocation,
    searchSuggestion,
    setSearchSuggestion: setSuggestion,
    searchMoveInDate,
    setSearchMoveInDate: setMoveInDate,
    searchDateRange,
    setSearchDateRange: setDateRange,
    searchOccupants,
    setSearchOccupants: setOccupants,
    searchPriceIdx,
    setSearchPriceIdx: setPriceIdx,
    searchBedsIdx,
    setSearchBedsIdx: setBedsIdx,
  };
}
