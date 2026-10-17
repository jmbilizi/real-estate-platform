import type { QueryClient } from '@tanstack/react-query';
import { listAllSavedHomes, saveListing } from '@/lib/api/saved-homes';
import { getSavedEntries, type SavedEntry, savedKeys } from '@/lib/query/saved-homes';

export type Notify = (message: string) => void;

const SYNC_PARTIAL = "Some homes you saved while signed out couldn't be synced yet.";
const SYNC_FAILED = "We couldn't load your saved homes. Please try again.";

let inFlight: Promise<void> | null = null;

/**
 * Merges the homes saved while signed out into the account after a sign-in or a reload (#25).
 *
 * Each local home is sent as the listing it was saved from. The server resolves the listing to its
 * home, so two listings of one home become one save, and the client needs no property mapping.
 * Then the server's list replaces the local one in the cache. A listing the server cannot save
 * stays in the list and the consumer is told. That case skips the refetch, because a refetch would
 * drop the home.
 */
export function syncSavedHomes(client: QueryClient, notify: Notify): Promise<void> {
  inFlight ??= run(client, notify).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function run(client: QueryClient, notify: Notify): Promise<void> {
  const local = getSavedEntries(client);
  const pending = local.filter((h) => h.listingId !== null);
  const outcomes = await Promise.allSettled(pending.map((h) => saveListing(h.listingId as string)));
  const unsynced = pending.filter((_, i) => outcomes[i].status === 'rejected');

  let server: Awaited<ReturnType<typeof listAllSavedHomes>>;
  try {
    server = await listAllSavedHomes();
  } catch {
    notify(SYNC_FAILED);
    return;
  }

  // The consumer may flip a home while the requests run. Replay those flips over the server list,
  // so the stale snapshot cannot undo them.
  const current = getSavedEntries(client);
  const wasLocal = new Set(local.map((h) => h.propertyId));
  const isLocal = new Set(current.map((h) => h.propertyId));
  const added = current.filter((h) => !wasLocal.has(h.propertyId));
  const removed = new Set(local.filter((h) => !isLocal.has(h.propertyId)).map((h) => h.propertyId));

  const merged: SavedEntry[] = server
    .filter((h) => !removed.has(h.propertyId))
    .map((h) => ({ propertyId: h.propertyId, listingId: h.savedFromListingId }));
  const keep = [...unsynced.filter((h) => isLocal.has(h.propertyId)), ...added];
  for (const entry of keep) {
    if (!merged.some((h) => h.propertyId === entry.propertyId)) merged.push(entry);
  }
  client.setQueryData<SavedEntry[]>(savedKeys.ids, merged);

  if (unsynced.length > 0) notify(SYNC_PARTIAL);
  else await client.invalidateQueries({ queryKey: savedKeys.all });
}
