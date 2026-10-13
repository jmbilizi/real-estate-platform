import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AppProvider, useApp } from './context';
import { store } from '@/lib/store/store';
import { clearSaved, saveEntry } from '@/lib/store/slices/favoritesSlice';

const mockTrackEvent = jest.fn();
jest.mock('@/lib/analytics', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}));
jest.mock('@/lib/saved-sync', () => ({
  toggleHome: jest.fn().mockResolvedValue(undefined),
  removeHome: jest.fn().mockResolvedValue(undefined),
  syncSavedHomes: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/api/account', () => ({
  ...jest.requireActual('@/lib/api/account'),
  getSession: jest.fn().mockResolvedValue({ authenticated: false }),
}));

const wrapper = ({ children }: { children: ReactNode }) => <AppProvider>{children}</AppProvider>;
const LISTING = { id: '0190a000-0000-7000-8000-000000000001', propertyId: 'p1' };

describe('save and unsave events (#826)', () => {
  beforeEach(() => {
    mockTrackEvent.mockReset();
    store.dispatch(clearSaved());
  });

  it('sends listing_save when a home is saved', () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    act(() => result.current.toggleSave(LISTING));
    expect(mockTrackEvent).toHaveBeenCalledWith('listing_save', { listingId: LISTING.id });
  });

  it('sends listing_unsave when a saved home is toggled off', () => {
    store.dispatch(saveEntry({ propertyId: 'p1', listingId: LISTING.id }));
    const { result } = renderHook(() => useApp(), { wrapper });
    act(() => result.current.toggleSave(LISTING));
    expect(mockTrackEvent).toHaveBeenCalledWith('listing_unsave', { listingId: LISTING.id });
    expect(mockTrackEvent).not.toHaveBeenCalledWith('listing_save', expect.anything());
  });
});
