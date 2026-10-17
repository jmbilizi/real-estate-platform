import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Provider } from 'react-redux';
import { makeTestQueryClient } from '@/test/renderWithClient';
import { store } from '@/lib/store/store';
import { saveListing, unsaveHomeById } from '@/lib/api/saved-homes';
import { type SavedEntry, savedKeys } from './saved-homes';
import { useToggleSaved } from './useToggleSaved';

jest.mock('@/lib/api/saved-homes', () => ({
  listAllSavedHomes: jest.fn().mockResolvedValue([]),
  saveListing: jest.fn(),
  unsaveHomeById: jest.fn(),
}));

const mockedSave = saveListing as jest.Mock;
const mockedUnsave = unsaveHomeById as jest.Mock;

const A: SavedEntry = { propertyId: 'home-a', listingId: 'listing-a' };
const B: SavedEntry = { propertyId: 'home-b', listingId: 'listing-b' };

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>
    <Provider store={store}>{children}</Provider>
  </QueryClientProvider>
);

const cached = () => client.getQueryData<SavedEntry[]>(savedKeys.ids)?.map((h) => h.propertyId);

describe('useToggleSaved', () => {
  beforeEach(() => {
    client = makeTestQueryClient();
    mockedSave.mockReset().mockResolvedValue({ saved: true });
    mockedUnsave.mockReset().mockResolvedValue({ saved: false });
  });

  it('changes the cache before the request answers', async () => {
    let answer: (v: unknown) => void = () => {};
    mockedSave.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const { result } = renderHook(() => useToggleSaved(), { wrapper });

    act(() => result.current.mutate({ entry: A, save: true, signedIn: true }));
    await waitFor(() => expect(cached()).toEqual(['home-a']));
    expect(mockedSave).toHaveBeenCalledWith('listing-a');

    await act(async () => answer({ saved: true }));
  });

  it('stays local and sends nothing when signed out', async () => {
    const { result } = renderHook(() => useToggleSaved(), { wrapper });

    act(() => result.current.mutate({ entry: A, save: true, signedIn: false }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(cached()).toEqual(['home-a']);
    expect(mockedSave).not.toHaveBeenCalled();
  });

  it('restores a failed unsave and shows the toast', async () => {
    mockedUnsave.mockRejectedValue(new Error('down'));
    client.setQueryData(savedKeys.ids, [A, B]);
    const before = store.getState().toast.toasts.length;
    const { result } = renderHook(() => useToggleSaved(), { wrapper });

    act(() => result.current.mutate({ entry: A, save: false, signedIn: true }));
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(client.getQueryData(savedKeys.ids)).toEqual([B, A]);
    expect(store.getState().toast.toasts.length).toBe(before + 1);
  });

  it('removes a failed save and keeps a later toggle', async () => {
    let fail: (e: unknown) => void = () => {};
    mockedSave.mockReturnValueOnce(new Promise((_, reject) => (fail = reject)));
    const { result } = renderHook(() => useToggleSaved(), { wrapper });

    act(() => result.current.mutate({ entry: A, save: true, signedIn: true }));
    act(() => result.current.mutate({ entry: B, save: true, signedIn: true }));
    await waitFor(() => expect(cached()).toEqual(['home-a', 'home-b']));

    await act(async () => fail(new Error('down')));
    await waitFor(() => expect(mockedSave).toHaveBeenCalledWith('listing-b'));
    await waitFor(() => expect(cached()).toEqual(['home-b']));
  });

  it('runs toggles one at a time, in order', async () => {
    let finishA: (v: unknown) => void = () => {};
    mockedSave.mockReturnValueOnce(new Promise((resolve) => (finishA = resolve)));
    const { result } = renderHook(() => useToggleSaved(), { wrapper });

    act(() => result.current.mutate({ entry: A, save: true, signedIn: true }));
    act(() => result.current.mutate({ entry: B, save: true, signedIn: true }));

    await waitFor(() => expect(mockedSave).toHaveBeenCalledTimes(1));
    expect(mockedSave).toHaveBeenLastCalledWith('listing-a');

    await act(async () => finishA({ saved: true }));
    await waitFor(() => expect(mockedSave).toHaveBeenCalledTimes(2));
    expect(mockedSave).toHaveBeenLastCalledWith('listing-b');
  });

  it('invalidates the saved homes after the last toggle settles', async () => {
    const spy = jest.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useToggleSaved(), { wrapper });

    act(() => result.current.mutate({ entry: A, save: true, signedIn: true }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: savedKeys.all }));
  });
});
