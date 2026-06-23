'use client';

import React, { ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Provider } from 'react-redux';
import { useAppDispatch, useAppSelector } from '@/lib/store/hooks';
import {
  AuthError,
  getProfile,
  getSession,
  loginAccount,
  logoutAccount,
  signupAccount,
} from '@/lib/api/account';
import { store } from '@/lib/store/store';
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
import {
  login,
  logout,
  setSessionChecked,
  setShowOnboarding,
  signup,
  updateProfile,
} from '@/lib/store/slices/authSlice';
import { clearSaved, toggleSave } from '@/lib/store/slices/favoritesSlice';
import { addToast } from '@/lib/store/slices/toastSlice';

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
  login: (email: string, password: string, remember?: boolean) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
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
  return (
    <Provider store={store}>
      <SessionVerifier />
      {children}
    </Provider>
  );
}

/**
 * Runs once inside AppProvider to verify the cached session against the server.
 * Extracted from useApp() to prevent duplicate calls (every useApp() consumer
 * would otherwise fire its own session check).
 */
function SessionVerifier() {
  const dispatch = useAppDispatch();

  // The store is already initialized from localStorage via preloadedState in store.ts.
  // This effect only handles the edge case where preloadedState didn't find a cached user.
  useIsomorphicLayoutEffect(() => {
    if (!store.getState().auth.sessionChecked) {
      dispatch(setSessionChecked());
    }
  }, [dispatch]);

  // Background verification: confirm the cached state is still valid.
  // Only dispatches when something actually changed to avoid a needless re-render.
  // Ref guard prevents React StrictMode from running this twice.
  const sessionVerified = useRef(false);
  useEffect(() => {
    if (sessionVerified.current) return;
    sessionVerified.current = true;

    getSession().then(async (session) => {
      const currentUser = store.getState().auth.user;
      if (session.authenticated && session.email) {
        if (currentUser?.email !== session.email) {
          dispatch(login({ email: session.email }));
        } else {
          dispatch(setSessionChecked());
        }
        // Only fetch profile from API if we don't already have it cached
        const needsProfile = !currentUser?.profileComplete;
        if (needsProfile) {
          try {
            const profile = await getProfile();
            if (profile.firstName) {
              dispatch(
                updateProfile({
                  firstName: profile.firstName,
                  lastName: profile.lastName,
                  displayName: profile.displayName,
                  bio: profile.bio,
                  dateOfBirth: profile.dateOfBirth,
                  emailNotificationsEnabled: profile.emailNotificationsEnabled,
                  smsNotificationsEnabled: profile.smsNotificationsEnabled,
                  pushNotificationsEnabled: profile.pushNotificationsEnabled,
                  marketingOptIn: profile.marketingOptIn,
                  profileComplete: true,
                }),
              );
            } else {
              dispatch(setShowOnboarding(true));
            }
          } catch (err) {
            if (err instanceof AuthError) {
              // Token expired/invalid — force re-login
              dispatch(logout());
            }
            // Other errors: non-blocking — display name will just show email
          }
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

  return null;
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
    async (email: string, password: string, remember?: boolean) => {
      const res = await loginAccount({ email, password, remember });
      dispatch(login({ email: res.email ?? email, accessToken: res.accessToken }));

      // Check if profile is complete — show onboarding if not
      try {
        const profile = await getProfile();
        if (profile.firstName) {
          dispatch(
            updateProfile({
              firstName: profile.firstName,
              lastName: profile.lastName,
              displayName: profile.displayName,
              bio: profile.bio,
              dateOfBirth: profile.dateOfBirth,
              emailNotificationsEnabled: profile.emailNotificationsEnabled,
              smsNotificationsEnabled: profile.smsNotificationsEnabled,
              pushNotificationsEnabled: profile.pushNotificationsEnabled,
              marketingOptIn: profile.marketingOptIn,
              profileComplete: true,
            }),
          );
        } else {
          dispatch(setShowOnboarding(true));
        }
      } catch {
        // Non-blocking — user can still use the app
      }
    },
    [dispatch],
  );

  const signupUser = useCallback(
    async (email: string, password: string) => {
      await signupAccount({ email, password });
      dispatch(signup({ email }));
      // Auto-login after signup to get tokens
      try {
        const res = await loginAccount({ email, password, remember: false });
        dispatch(login({ email: res.email ?? email, accessToken: res.accessToken }));
      } catch {
        // Signup succeeded but auto-login failed — user can sign in manually
        dispatch(
          addToast({
            id: `signup-login-${Date.now()}`,
            message: 'Account created! Please sign in.',
            type: 'info',
            duration: 5000,
          }),
        );
      }
    },
    [dispatch],
  );

  const logoutUser = useCallback(async () => {
    await logoutAccount().catch(() => {}); // clear server cookies
    dispatch(logout());
    dispatch(clearSaved());
    dispatch(
      addToast({
        id: `signout-${Date.now()}`,
        message: "You've been signed out.",
        type: 'success',
        duration: 3000,
      }),
    );
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
