import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { QueryClientProvider } from '@tanstack/react-query';
import { AppProvider } from './context';
import { AuthError } from '@/lib/api/account';
import { accountKeys } from '@/lib/query/account';
import { savedKeys } from '@/lib/query/saved-homes';
import { store } from '@/lib/store/store';
import { login, logout } from '@/lib/store/slices/authSlice';
import { makeTestQueryClient } from '@/test/renderWithClient';

jest.mock('@/lib/saved-sync', () => ({ syncSavedHomes: jest.fn().mockResolvedValue(undefined) }));
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

const seed = (email: string) =>
  client.setQueryData(accountKeys.profile(email), { email, firstName: 'Ada' });

describe('account query sync', () => {
  beforeEach(() => {
    store.dispatch(logout());
    client = makeTestQueryClient();
  });

  it('clears the cache when the user switches', () => {
    store.dispatch(login({ email: 'a@example.com' }));
    renderHook(() => null, { wrapper });
    seed('a@example.com');
    act(() => {
      store.dispatch(login({ email: 'b@example.com' }));
    });
    expect(client.getQueryData(accountKeys.profile('a@example.com'))).toBeUndefined();
  });

  it('clears the cache on logout', () => {
    store.dispatch(login({ email: 'a@example.com' }));
    renderHook(() => null, { wrapper });
    seed('a@example.com');
    act(() => {
      store.dispatch(logout());
    });
    expect(client.getQueryData(accountKeys.profile('a@example.com'))).toBeUndefined();
  });

  it('clears the saved homes on logout', () => {
    store.dispatch(login({ email: 'a@example.com' }));
    renderHook(() => null, { wrapper });
    client.setQueryData(savedKeys.ids, [{ propertyId: 'p1', listingId: null }]);
    act(() => {
      store.dispatch(logout());
    });
    expect(client.getQueryData(savedKeys.ids)).toBeUndefined();
  });

  it('keeps signed-out saves when a user signs in', () => {
    renderHook(() => null, { wrapper });
    client.setQueryData(savedKeys.ids, [{ propertyId: 'p1', listingId: 'l1' }]);
    act(() => {
      store.dispatch(login({ email: 'a@example.com' }));
    });
    expect(client.getQueryData(savedKeys.ids)).toBeDefined();
  });

  it('keeps the cache while the same user stays signed in', () => {
    store.dispatch(login({ email: 'a@example.com' }));
    renderHook(() => null, { wrapper });
    seed('a@example.com');
    expect(client.getQueryData(accountKeys.profile('a@example.com'))).toBeDefined();
  });

  it('signs out on an AuthError from an account query', async () => {
    store.dispatch(login({ email: 'a@example.com' }));
    renderHook(() => null, { wrapper });
    const queryFn = jest.fn().mockRejectedValue(new AuthError(401));
    await act(async () => {
      await client
        .fetchQuery({ queryKey: accountKeys.profile('a@example.com'), queryFn })
        .catch(() => undefined);
    });
    await waitFor(() => expect(store.getState().auth.user).toBeNull());
  });
});
