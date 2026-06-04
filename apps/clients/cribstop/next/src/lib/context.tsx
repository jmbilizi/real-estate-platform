'use client';

import React, { ReactNode, useCallback, useEffect, useLayoutEffect, useMemo } from 'react';
import { Provider } from 'react-redux';
import { useAppDispatch, useAppSelector } from '@/lib/store/hooks';
import { getSession, loginAccount, logoutAccount, signupAccount } from '@/lib/api/account';
import { AUTH_CACHE_KEY, store } from '@/lib/store/store';
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
  selectSessionChecked,
  selectShowHeaderPill,
  selectUser,
} from '@/lib/store/selectors';
import { login, logout, setSessionChecked, signup } from '@/lib/store/slices/authSlice';
import { clearSaved, toggleSave } from '@/lib/store/slices/favoritesSlice';

// useLayoutEffect on the client (fires before first paint), useEffect on the server (no-op)
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;
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
  sessionLoading: boolean;
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
  const sessionChecked = useAppSelector(selectSessionChecked);
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
      const res = await loginAccount({ email, password });
      dispatch(login({ email: res.email ?? email, accessToken: res.accessToken }));
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

  const logoutUser = useCallback(async () => {
    await logoutAccount().catch(() => {}); // clear server cookies
    dispatch(logout());
    dispatch(clearSaved());
  }, [dispatch]);

  // Restore auth from localStorage synchronously before the browser's first paint.
  // This means returning users never see the ghost placeholder flash.
  useIsomorphicLayoutEffect(() => {
    try {
      const raw = localStorage.getItem(AUTH_CACHE_KEY);
      if (raw) {
        const cached = JSON.parse(raw) as {
          user?: { email: string } | null;
          accessToken?: string | null;
        };
        if (cached.user?.email) {
          dispatch(
            login({ email: cached.user.email, accessToken: cached.accessToken ?? undefined }),
          );
          return;
        }
      }
    } catch {}
    dispatch(setSessionChecked());
  }, [dispatch]);

  // Background verification: confirm the cached state is still valid.
  // Only dispatches when something actually changed to avoid a needless re-render.
  useEffect(() => {
    getSession().then((session) => {
      const currentUser = store.getState().auth.user;
      if (session.authenticated && session.email) {
        if (currentUser?.email !== session.email) {
          dispatch(login({ email: session.email }));
        } else {
          dispatch(setSessionChecked());
        }
      } else {
        if (currentUser) {
          // Session expired — clear local state
          dispatch(logout());
          dispatch(clearSaved());
        } else {
          dispatch(setSessionChecked());
        }
      }
    });
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
    sessionLoading: !sessionChecked,
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
