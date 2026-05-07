'use client';

import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';

interface User {
  name: string;
  email: string;
  avatar?: string;
}

interface AppContextValue {
  user: User | null;
  savedIds: Set<string>;
  login: (email: string, password: string) => void;
  signup: (name: string, email: string, password: string) => void;
  logout: () => void;
  toggleSave: (id: string) => void;
  isSaved: (id: string) => boolean;
  listingTab: 'for-sale' | 'for-rent';
  setListingTab: (tab: 'for-sale' | 'for-rent') => void;
  /** True when the header should show the search pill instead of the category tabs */
  showHeaderPill: boolean;
  setShowHeaderPill: (v: boolean) => void;
  /** True when the compact pill has been clicked and the header is showing the expanded search bar */
  headerExpanded: boolean;
  setHeaderExpanded: (v: boolean) => void;
  /** True when the mobile full-screen search sheet is open */
  mobileSearchOpen: boolean;
  setMobileSearchOpen: (v: boolean) => void;
  /** Shared search state — kept in sync across all CompactSearchBar instances */
  searchLocation: string;
  setSearchLocation: (v: string) => void;

  searchSuggestion: any | null;

  setSearchSuggestion: (v: any | null) => void;
  searchMoveInDate: string;
  setSearchMoveInDate: (v: string) => void;
  searchOccupants: { adults: number; children: number; infants: number; pets: number };
  setSearchOccupants: (v: {
    adults: number;
    children: number;
    infants: number;
    pets: number;
  }) => void;
  searchPriceIdx: number;
  setSearchPriceIdx: (v: number) => void;
  searchBedsIdx: number;
  setSearchBedsIdx: (v: number) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [listingTab, setListingTab] = useState<'for-sale' | 'for-rent'>('for-sale');
  // Default false — pages with SearchSection manage this; pages without call useShowHeaderPill()
  const [showHeaderPill, setShowHeaderPill] = useState(false);
  const [headerExpanded, setHeaderExpanded] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [searchLocation, setSearchLocation] = useState('');
  const [searchSuggestion, setSearchSuggestion] = useState<any | null>(null);
  const [searchMoveInDate, setSearchMoveInDate] = useState('');
  const [searchOccupants, setSearchOccupants] = useState({
    adults: 0,
    children: 0,
    infants: 0,
    pets: 0,
  });
  const [searchPriceIdx, setSearchPriceIdx] = useState(0);
  const [searchBedsIdx, setSearchBedsIdx] = useState(0);

  const login = useCallback((_email: string, _password: string) => {
    setUser({ name: 'Alex Johnson', email: _email, avatar: undefined });
  }, []);

  const signup = useCallback((_name: string, _email: string, _password: string) => {
    setUser({ name: _name, email: _email });
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setSavedIds(new Set());
  }, []);

  const toggleSave = useCallback((id: string) => {
    setSavedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const isSaved = useCallback((id: string) => savedIds.has(id), [savedIds]);

  return (
    <AppContext.Provider
      value={{
        user,
        savedIds,
        login,
        signup,
        logout,
        toggleSave,
        isSaved,
        listingTab,
        setListingTab,
        showHeaderPill,
        setShowHeaderPill,
        headerExpanded,
        setHeaderExpanded,
        mobileSearchOpen,
        setMobileSearchOpen,
        searchLocation,
        setSearchLocation,
        searchSuggestion,
        setSearchSuggestion,
        searchMoveInDate,
        setSearchMoveInDate,
        searchOccupants,
        setSearchOccupants,
        searchPriceIdx,
        setSearchPriceIdx,
        searchBedsIdx,
        setSearchBedsIdx,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

/** Call this in any page that has no SearchSection but needs the compact header pill. */
export function useShowHeaderPill() {
  const { setShowHeaderPill } = useApp();
  useEffect(() => {
    document.documentElement.setAttribute('data-header-pill', '');
    setShowHeaderPill(true);
    return () => {
      document.documentElement.removeAttribute('data-header-pill');
      setShowHeaderPill(false);
    };
  }, [setShowHeaderPill]);
}
