import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { listAllSavedHomes } from '@/lib/api/saved-homes';

/**
 * The store keys on the home (`propertyId`), never on the listing (#25).
 * The server keys a save on `(account_id, property_id)` (#23). Bright issues a new listing row when
 * the listing agreement changes, so a listing key would detach from the home the consumer saved.
 * One home has many listings, so one flip changes the heart on every card, pin, popup and modal.
 *
 * `listingId` is display context only: the listing the consumer saved from. A signed-out save
 * keeps it so that sign-in can ask the server to resolve it to the home.
 */
export interface SavedEntry {
  propertyId: string;
  listingId: string | null;
}

/** Both keys sit under `['saved-homes']`, so one invalidation refreshes the ids and the page list. */
export const savedKeys = {
  all: ['saved-homes'] as const,
  ids: ['saved-homes', 'ids'] as const,
  page: (signedIn: boolean, localKey: string) =>
    ['saved-homes', 'page', signedIn, localKey] as const,
};

export const SAVED_MUTATION_KEY = savedKeys.all;
/** Toggles run one at a time, in the order the consumer made them. */
export const SAVED_MUTATION_SCOPE = { id: 'saved-homes' } as const;

/**
 * The saved home ids. Signed in, the server list fills it. Signed out, the query stays disabled and
 * `setQueryData` holds the local saves. They are personal data, so nothing persists this cache.
 * `gcTime: Infinity` keeps signed-out saves while no component observes the query.
 */
export function savedHomesOptions(signedIn: boolean) {
  return queryOptions({
    queryKey: savedKeys.ids,
    queryFn: async ({ signal }): Promise<SavedEntry[]> =>
      (await listAllSavedHomes(signal)).map((h) => ({
        propertyId: h.propertyId,
        listingId: h.savedFromListingId,
      })),
    enabled: signedIn,
    gcTime: Infinity,
  });
}

export const getSavedEntries = (client: QueryClient): SavedEntry[] =>
  client.getQueryData<SavedEntry[]>(savedKeys.ids) ?? [];

/** Idempotent. A second listing of a saved home changes nothing. */
export function addEntry(entries: SavedEntry[] | undefined, entry: SavedEntry): SavedEntry[] {
  const list = entries ?? [];
  return list.some((h) => h.propertyId === entry.propertyId) ? list : [...list, entry];
}

export function removeEntry(entries: SavedEntry[] | undefined, propertyId: string): SavedEntry[] {
  return (entries ?? []).filter((h) => h.propertyId !== propertyId);
}
