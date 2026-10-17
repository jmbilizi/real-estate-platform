import type { QueryClient } from '@tanstack/react-query';
import { listAllSavedHomes, saveListing } from '@/lib/api/saved-homes';
import { makeTestQueryClient } from '@/test/renderWithClient';
import { type SavedEntry, savedKeys } from '@/lib/query/saved-homes';
import { syncSavedHomes } from './saved-sync';

jest.mock('@/lib/api/saved-homes', () => ({
  listAllSavedHomes: jest.fn(),
  saveListing: jest.fn(),
  unsaveHomeById: jest.fn(),
}));

const mockedSave = saveListing as jest.Mock;
const mockedList = listAllSavedHomes as jest.Mock;

const HOME = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER_HOME = 'bbbbbbbb-0000-4000-8000-000000000002';
const WITHHELD_HOME = 'cccccccc-0000-4000-8000-000000000003';

let client: QueryClient;
const seed = (...entries: SavedEntry[]) => client.setQueryData(savedKeys.ids, entries);
const homes = () => client.getQueryData<SavedEntry[]>(savedKeys.ids)?.map((h) => h.propertyId);

const serverHome = (propertyId: string, savedFromListingId: string | null) => ({
  propertyId,
  savedFromListingId,
});

describe('syncSavedHomes', () => {
  beforeEach(() => {
    client = makeTestQueryClient();
    mockedSave.mockReset().mockResolvedValue({ propertyId: HOME, saved: true });
    mockedList.mockReset();
  });

  it('sends each locally saved listing so the server resolves the home, then adopts the server list', async () => {
    mockedList.mockResolvedValue([serverHome(HOME, 'listing-1')]);
    seed({ propertyId: HOME, listingId: 'listing-1' });
    await syncSavedHomes(client, jest.fn());

    expect(mockedSave).toHaveBeenCalledTimes(1);
    expect(mockedSave).toHaveBeenCalledWith('listing-1');
    expect(client.getQueryData(savedKeys.ids)).toEqual([
      { propertyId: HOME, listingId: 'listing-1' },
    ]);
  });

  it('invalidates the saved homes after the merge', async () => {
    mockedList.mockResolvedValue([serverHome(HOME, 'listing-1')]);
    seed({ propertyId: HOME, listingId: 'listing-1' });
    const spy = jest.spyOn(client, 'invalidateQueries');
    await syncSavedHomes(client, jest.fn());

    expect(spy).toHaveBeenCalledWith({ queryKey: savedKeys.all });
  });

  it('keeps a home the server could not save, says so, and skips the refetch', async () => {
    mockedSave.mockImplementation((id: string) =>
      id === 'withheld' ? Promise.reject(new Error('404')) : Promise.resolve({}),
    );
    mockedList.mockResolvedValue([serverHome(HOME, 'listing-1'), serverHome(OTHER_HOME, null)]);
    seed(
      { propertyId: HOME, listingId: 'listing-1' },
      { propertyId: WITHHELD_HOME, listingId: 'withheld' },
    );
    const spy = jest.spyOn(client, 'invalidateQueries');
    const notify = jest.fn();
    await syncSavedHomes(client, notify);

    expect(homes()).toEqual([HOME, OTHER_HOME, WITHHELD_HOME]);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(spy).not.toHaveBeenCalled();
  });

  it('keeps the local list when the server list fails to load', async () => {
    mockedList.mockRejectedValue(new Error('down'));
    seed({ propertyId: HOME, listingId: 'listing-1' });
    const notify = jest.fn();
    await syncSavedHomes(client, notify);

    expect(homes()).toEqual([HOME]);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('keeps a flip the consumer made while the sync ran', async () => {
    let finishList: (v: unknown) => void = () => {};
    mockedList.mockReturnValue(new Promise((resolve) => (finishList = resolve)));
    seed({ propertyId: HOME, listingId: 'listing-1' });
    const pending = syncSavedHomes(client, jest.fn());

    // During the sync: unsave HOME, save OTHER_HOME.
    seed({ propertyId: OTHER_HOME, listingId: 'listing-9' });
    finishList([serverHome(HOME, 'listing-1')]);
    await pending;

    expect(homes()).toEqual([OTHER_HOME]);
  });

  it('runs one sync at a time', async () => {
    mockedList.mockResolvedValue([]);
    await Promise.all([syncSavedHomes(client, jest.fn()), syncSavedHomes(client, jest.fn())]);

    expect(mockedList).toHaveBeenCalledTimes(1);
  });
});
