import { configureStore } from '@reduxjs/toolkit';
import favoritesReducer, { saveEntry, unsaveEntry } from '@/lib/store/slices/favoritesSlice';
import { listAllSavedHomes, saveListing, unsaveHomeById } from '@/lib/api/saved-homes';
import { removeHome, syncSavedHomes, toggleHome } from './saved-sync';

jest.mock('@/lib/api/saved-homes', () => ({
  listAllSavedHomes: jest.fn(),
  saveListing: jest.fn(),
  unsaveHomeById: jest.fn(),
}));

const mockedSave = saveListing as jest.Mock;
const mockedUnsave = unsaveHomeById as jest.Mock;
const mockedList = listAllSavedHomes as jest.Mock;

const HOME = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER_HOME = 'bbbbbbbb-0000-4000-8000-000000000002';

function makeStore() {
  return configureStore({ reducer: { favorites: favoritesReducer } });
}

const homes = (store: ReturnType<typeof makeStore>) =>
  store.getState().favorites.homes.map((h) => h.propertyId);

describe('toggleHome', () => {
  beforeEach(() => {
    mockedSave.mockReset().mockResolvedValue({ propertyId: HOME, saved: true });
    mockedUnsave.mockReset().mockResolvedValue({ propertyId: HOME, saved: false });
  });

  it('keys the store on the home and keeps the listing as context', async () => {
    const store = makeStore();
    await toggleHome(store, { id: 'listing-1', propertyId: HOME }, false, jest.fn());

    expect(store.getState().favorites.homes).toEqual([
      { propertyId: HOME, listingId: 'listing-1' },
    ]);
  });

  it('stays local and calls no API for a signed-out visitor', async () => {
    const store = makeStore();
    await toggleHome(store, { id: 'listing-1', propertyId: HOME }, false, jest.fn());
    await toggleHome(store, { id: 'listing-1', propertyId: HOME }, false, jest.fn());

    expect(homes(store)).toEqual([]);
    expect(mockedSave).not.toHaveBeenCalled();
    expect(mockedUnsave).not.toHaveBeenCalled();
  });

  it('saves through the listing and unsaves through the home when signed in', async () => {
    const store = makeStore();
    await toggleHome(store, { id: 'listing-1', propertyId: HOME }, true, jest.fn());
    expect(mockedSave).toHaveBeenCalledWith('listing-1');

    // A different listing of the same saved home flips the home off: one home, one state.
    await toggleHome(store, { id: 'listing-2', propertyId: HOME }, true, jest.fn());
    expect(mockedUnsave).toHaveBeenCalledWith(HOME);
    expect(homes(store)).toEqual([]);
  });

  it('rolls a failed save back and tells the consumer', async () => {
    mockedSave.mockRejectedValue(new Error('down'));
    const store = makeStore();
    const notify = jest.fn();
    await toggleHome(store, { id: 'listing-1', propertyId: HOME }, true, notify);

    expect(homes(store)).toEqual([]);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('rolls a failed unsave back and tells the consumer', async () => {
    mockedUnsave.mockRejectedValue(new Error('down'));
    const store = makeStore();
    store.dispatch(saveEntry({ propertyId: HOME, listingId: 'listing-1' }));
    const notify = jest.fn();
    await toggleHome(store, { id: 'listing-2', propertyId: HOME }, true, notify);

    expect(store.getState().favorites.homes).toEqual([
      { propertyId: HOME, listingId: 'listing-1' },
    ]);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('flips the heart before the API answers', async () => {
    let answer: (v: unknown) => void = () => {};
    mockedSave.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const store = makeStore();
    const pending = toggleHome(store, { id: 'listing-1', propertyId: HOME }, true, jest.fn());

    expect(homes(store)).toEqual([HOME]);
    answer({ propertyId: HOME, saved: true });
    await pending;
  });
});

describe('removeHome', () => {
  beforeEach(() => {
    mockedUnsave.mockReset().mockResolvedValue({ propertyId: HOME, saved: false });
  });

  it('unsaves by property id and rolls back on failure', async () => {
    const store = makeStore();
    store.dispatch(saveEntry({ propertyId: HOME, listingId: null }));
    await removeHome(store, HOME, true, jest.fn());
    expect(mockedUnsave).toHaveBeenCalledWith(HOME);
    expect(homes(store)).toEqual([]);

    mockedUnsave.mockRejectedValue(new Error('down'));
    store.dispatch(saveEntry({ propertyId: HOME, listingId: null }));
    const notify = jest.fn();
    await removeHome(store, HOME, true, notify);
    expect(homes(store)).toEqual([HOME]);
    expect(notify).toHaveBeenCalled();
  });
});

describe('syncSavedHomes', () => {
  beforeEach(() => {
    mockedSave.mockReset().mockResolvedValue({ propertyId: HOME, saved: true });
    mockedList.mockReset();
  });

  const serverHome = (propertyId: string, savedFromListingId: string | null) => ({
    propertyId,
    savedFromListingId,
  });

  it('sends each locally saved listing so the server resolves the home, then adopts the server list', async () => {
    mockedList.mockResolvedValue([serverHome(HOME, 'listing-1')]);
    const store = makeStore();
    store.dispatch(saveEntry({ propertyId: HOME, listingId: 'listing-1' }));
    await syncSavedHomes(store, jest.fn());

    expect(mockedSave).toHaveBeenCalledTimes(1);
    expect(mockedSave).toHaveBeenCalledWith('listing-1');
    expect(store.getState().favorites.homes).toEqual([
      { propertyId: HOME, listingId: 'listing-1' },
    ]);
  });

  it('collapses two listings of one home to one save', async () => {
    const store = makeStore();
    // Both listings were saved while signed out. The local store already keys on the home.
    store.dispatch(saveEntry({ propertyId: HOME, listingId: 'listing-1' }));
    store.dispatch(saveEntry({ propertyId: HOME, listingId: 'listing-2' }));
    mockedList.mockResolvedValue([serverHome(HOME, 'listing-1')]);
    await syncSavedHomes(store, jest.fn());

    expect(mockedSave).toHaveBeenCalledTimes(1);
    expect(homes(store)).toEqual([HOME]);
  });

  it('keeps a home the server could not save, and says so', async () => {
    mockedSave.mockImplementation((id: string) =>
      id === 'withheld' ? Promise.reject(new Error('404')) : Promise.resolve({}),
    );
    mockedList.mockResolvedValue([serverHome(HOME, 'listing-1'), serverHome(OTHER_HOME, null)]);
    const store = makeStore();
    store.dispatch(saveEntry({ propertyId: HOME, listingId: 'listing-1' }));
    store.dispatch(
      saveEntry({ propertyId: 'cccccccc-0000-4000-8000-000000000003', listingId: 'withheld' }),
    );
    const notify = jest.fn();
    await syncSavedHomes(store, notify);

    expect(homes(store)).toEqual([HOME, OTHER_HOME, 'cccccccc-0000-4000-8000-000000000003']);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('keeps the local list when the server list fails to load', async () => {
    mockedList.mockRejectedValue(new Error('down'));
    const store = makeStore();
    store.dispatch(saveEntry({ propertyId: HOME, listingId: 'listing-1' }));
    const notify = jest.fn();
    await syncSavedHomes(store, notify);

    expect(homes(store)).toEqual([HOME]);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('keeps a flip the consumer made while the sync ran', async () => {
    let finishList: (v: unknown) => void = () => {};
    mockedList.mockReturnValue(new Promise((resolve) => (finishList = resolve)));
    const store = makeStore();
    store.dispatch(saveEntry({ propertyId: HOME, listingId: 'listing-1' }));
    const pending = syncSavedHomes(store, jest.fn());

    // During the sync: unsave HOME, save OTHER_HOME.
    store.dispatch(unsaveEntry(HOME));
    store.dispatch(saveEntry({ propertyId: OTHER_HOME, listingId: 'listing-9' }));
    finishList([serverHome(HOME, 'listing-1')]);
    await pending;

    expect(homes(store)).toEqual([OTHER_HOME]);
  });

  it('runs one sync at a time', async () => {
    mockedList.mockResolvedValue([]);
    const store = makeStore();
    await Promise.all([syncSavedHomes(store, jest.fn()), syncSavedHomes(store, jest.fn())]);

    expect(mockedList).toHaveBeenCalledTimes(1);
  });
});
