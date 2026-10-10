'use client';

import React, { ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Provider } from 'react-redux';
import { useAppDispatch, useAppSelector } from '@/lib/store/hooks';
import {
  AuthError,
  completeSignup,
  CompleteSignupOutcome,
  getProfile,
  getSession,
  loginAccount,
  logoutAccount,
} from '@/lib/api/account';
import { store } from '@/lib/store/store';
import {
  selectActiveTab,
  selectHeaderExpanded,
  selectListingTab,
  selectListingType,
  selectMobileSearchOpen,
  selectSavedHomes,
  selectSearchDateRange,
  selectSearchListingType,
  selectSearchLocation,
  selectSearchMoveInDate,
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
  updateProfile,
} from '@/lib/store/slices/authSlice';
import { clearSaved, type SavedEntry, saveEntry } from '@/lib/store/slices/favoritesSlice';
import { removeHome, syncSavedHomes, toggleHome } from '@/lib/saved-sync';
import { trackEvent } from '@/lib/analytics';
import { addToast } from '@/lib/store/slices/toastSlice';

// useLayoutEffect on the client (fires before first paint), useEffect on the server (no-op)
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;
import {
  type SearchListingType,
  setSearchDateRange,
  setSearchListingType,
  setSearchLocation,
  setSearchMoveInDate,
  setSearchPriceIdx,
  setSearchSuggestion,
} from '@/lib/store/slices/searchSlice';
import {
  setActiveTab,
  setHeaderExpanded,
  setListingTab,
  setListingType,
  setMobileSearchOpen,
  setShowHeaderPill,
} from '@/lib/store/slices/uiSlice';
import {
  ListingTab,
  ListingType,
  NavTab,
  SearchDateRange,
  SearchSuggestion,
  User,
} from '@/lib/store/types';

interface AppContextValue {
  user: User | null;
  sessionLoading: boolean;
  /** Saved homes, keyed on property id (#25). */
  savedHomes: SavedEntry[];
  savedPropertyIds: Set<string>;
  login: (email: string, password: string, remember?: boolean) => Promise<void>;
  completeSignup: (
    email: string,
    signupProof: string,
    password: string,
  ) => Promise<CompleteSignupOutcome>;
  logout: () => void;
  /** Flips the home of a listing, so every listing of that home flips together. */
  toggleSave: (listing: { id: string; propertyId: string }) => void;
  /** Removes a saved home by property id, for a home with no listing to flip. */
  removeSaved: (propertyId: string) => void;
  /** Adds homes the server reports as saved. Never removes one. */
  adoptSaved: (entries: SavedEntry[]) => void;
  isSaved: (propertyId: string) => boolean;
  listingTab: ListingTab;
  setListingTab: (tab: ListingTab) => void;
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  listingType: ListingType;
  setListingType: (type: ListingType) => void;
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
  searchPriceIdx: number;
  setSearchPriceIdx: (v: number) => void;
  searchListingType: SearchListingType;
  setSearchListingType: (v: SearchListingType) => void;
}

export function AppProvider({ children }: { children: ReactNode }) {
  return (
    <Provider store={store}>
      <SessionVerifier />
      {children}
    </Provider>
  );
}

function notifyError(dispatch: (action: ReturnType<typeof addToast>) => unknown) {
  return (message: string) =>
    dispatch(addToast({ id: `saved-${Date.now()}`, message, type: 'error', duration: 5000 }));
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
        void syncSavedHomes(store, notifyError(dispatch));
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
  const savedHomes = useAppSelector(selectSavedHomes);
  const listingTab = useAppSelector(selectListingTab);
  const activeTab = useAppSelector(selectActiveTab);
  const listingType = useAppSelector(selectListingType);
  const showHeaderPill = useAppSelector(selectShowHeaderPill);
  const headerExpanded = useAppSelector(selectHeaderExpanded);
  const mobileSearchOpen = useAppSelector(selectMobileSearchOpen);
  const searchLocation = useAppSelector(selectSearchLocation);
  const searchSuggestion = useAppSelector(selectSearchSuggestion);
  const searchMoveInDate = useAppSelector(selectSearchMoveInDate);
  const searchDateRange = useAppSelector(selectSearchDateRange);
  const searchPriceIdx = useAppSelector(selectSearchPriceIdx);
  const searchListingType = useAppSelector(selectSearchListingType);

  const savedPropertyIds = useMemo(
    () => new Set(savedHomes.map((h) => h.propertyId)),
    [savedHomes],
  );

  const startSession = useCallback(
    async (email: string, res: { email?: string; accessToken?: string }) => {
      dispatch(login({ email: res.email ?? email, accessToken: res.accessToken }));
      // The server resolves homes saved while signed out, then its list replaces the local one.
      void syncSavedHomes(store, notifyError(dispatch));

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

  const loginUser = useCallback(
    async (email: string, password: string, remember?: boolean) => {
      const res = await loginAccount({ email, password, remember });
      await startSession(email, res);
    },
    [startSession],
  );

  // Completing sign-up signs the consumer in: the email code already proved the address.
  const completeSignupUser = useCallback(
    async (email: string, signupProof: string, password: string) => {
      const outcome = await completeSignup({ email, signupProof, password });
      if (outcome.ok) await startSession(email, outcome.session);
      return outcome;
    },
    [startSession],
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
    (listing: { id: string; propertyId: string }) => {
      const signedIn = store.getState().auth.user !== null;
      const alreadySaved = store
        .getState()
        .favorites.homes.some((h) => h.propertyId === listing.propertyId);
      if (!alreadySaved) trackEvent('listing_save', { listingId: listing.id });
      void toggleHome(store, listing, signedIn, notifyError(dispatch));
    },
    [dispatch],
  );

  const removeSaved = useCallback(
    (propertyId: string) => {
      const signedIn = store.getState().auth.user !== null;
      void removeHome(store, propertyId, signedIn, notifyError(dispatch));
    },
    [dispatch],
  );

  const adoptSaved = useCallback(
    (entries: SavedEntry[]) => {
      for (const entry of entries) dispatch(saveEntry(entry));
    },
    [dispatch],
  );

  const isSaved = useCallback(
    (propertyId: string) => savedPropertyIds.has(propertyId),
    [savedPropertyIds],
  );

  const setTab = useCallback(
    (tab: ListingTab) => {
      dispatch(setListingTab(tab));
    },
    [dispatch],
  );

  const setNavTab = useCallback(
    (tab: NavTab) => {
      dispatch(setActiveTab(tab));
    },
    [dispatch],
  );

  const setType = useCallback(
    (type: ListingType) => {
      dispatch(setListingType(type));
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

  const setPriceIdx = useCallback(
    (v: number) => {
      dispatch(setSearchPriceIdx(v));
    },
    [dispatch],
  );

  const setSearchListingTypeCtx = useCallback(
    (v: SearchListingType) => {
      dispatch(setSearchListingType(v));
    },
    [dispatch],
  );

  return {
    user,
    sessionLoading: !sessionChecked,
    savedHomes,
    savedPropertyIds,
    login: loginUser,
    completeSignup: completeSignupUser,
    logout: logoutUser,
    toggleSave: toggleSavedListing,
    removeSaved,
    adoptSaved,
    isSaved,
    listingTab,
    setListingTab: setTab,
    activeTab,
    setActiveTab: setNavTab,
    listingType,
    setListingType: setType,
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
    searchPriceIdx,
    setSearchPriceIdx: setPriceIdx,
    searchListingType,
    setSearchListingType: setSearchListingTypeCtx,
  };
}
