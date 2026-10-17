import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { QueryClientProvider } from '@tanstack/react-query';
import { makeTestQueryClient } from '@/test/renderWithClient';
import { savedKeys } from '@/lib/query/saved-homes';
import { AppProvider, useApp } from './context';

const mockTrackEvent = jest.fn();
jest.mock('@/lib/analytics', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}));
jest.mock('@/lib/saved-sync', () => ({
  syncSavedHomes: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/api/account', () => ({
  ...jest.requireActual('@/lib/api/account'),
  getSession: jest.fn().mockResolvedValue({ authenticated: false }),
}));

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>
    <AppProvider>{children}</AppProvider>
  </QueryClientProvider>
);
const LISTING = { id: '0190a000-0000-7000-8000-000000000001', propertyId: 'p1' };

describe('save and unsave events (#826)', () => {
  beforeEach(() => {
    mockTrackEvent.mockReset();
    client = makeTestQueryClient();
  });

  it('sends listing_save when a home is saved', () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    act(() => result.current.toggleSave(LISTING));
    expect(mockTrackEvent).toHaveBeenCalledWith('listing_save', { listingId: LISTING.id });
  });

  it('sends listing_unsave when a saved home is toggled off', () => {
    client.setQueryData(savedKeys.ids, [{ propertyId: 'p1', listingId: LISTING.id }]);
    const { result } = renderHook(() => useApp(), { wrapper });
    act(() => result.current.toggleSave(LISTING));
    expect(mockTrackEvent).toHaveBeenCalledWith('listing_unsave', { listingId: LISTING.id });
    expect(mockTrackEvent).not.toHaveBeenCalledWith('listing_save', expect.anything());
  });
});
