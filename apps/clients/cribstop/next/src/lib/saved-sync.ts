import type { UnknownAction } from '@reduxjs/toolkit';
import { listAllSavedHomes, saveListing, unsaveHomeById } from '@/lib/api/saved-homes';
import {
  replaceSaved,
  type SavedEntry,
  saveEntry,
  unsaveEntry,
} from '@/lib/store/slices/favoritesSlice';

/**
 * The save flow of #25, kept out of React so the optimistic flip and the sign-in resolution are
 * testable on their own. `StoreLike` is the part of the Redux store this needs.
 */
export interface StoreLike {
  dispatch: (action: UnknownAction) => unknown;
  getState: () => { favorites: { homes: SavedEntry[] } };
}

export type Notify = (message: string) => void;

const SAVE_FAILED = "We couldn't save that home. Please try again.";
const UNSAVE_FAILED = "We couldn't remove that home. Please try again.";
const SYNC_PARTIAL = "Some homes you saved while signed out couldn't be synced yet.";
const SYNC_FAILED = "We couldn't load your saved homes. Please try again.";

const isSaved = (store: StoreLike, propertyId: string) =>
  store.getState().favorites.homes.some((h) => h.propertyId === propertyId);

/**
 * Flips the home of a listing. The flip is optimistic: the store changes first, so every card,
 * map popup, detail page and modal of that home changes in the same frame. A signed-in flip then
 * calls the API. A failure restores the previous state and tells the consumer.
 *
 * Saving a home that is already saved changes nothing and sends nothing.
 */
export async function toggleHome(
  store: StoreLike,
  listing: { id: string; propertyId: string },
  signedIn: boolean,
  notify: Notify,
): Promise<void> {
  const { propertyId } = listing;
  if (isSaved(store, propertyId)) {
    const previous = store.getState().favorites.homes.find((h) => h.propertyId === propertyId);
    store.dispatch(unsaveEntry(propertyId));
    if (!signedIn) return;
    try {
      await unsaveHomeById(propertyId);
    } catch {
      if (!isSaved(store, propertyId) && previous) store.dispatch(saveEntry(previous));
      notify(UNSAVE_FAILED);
    }
    return;
  }

  store.dispatch(saveEntry({ propertyId, listingId: listing.id }));
  if (!signedIn) return;
  try {
    await saveListing(listing.id);
  } catch {
    if (isSaved(store, propertyId)) store.dispatch(unsaveEntry(propertyId));
    notify(SAVE_FAILED);
  }
}

/** Removes a saved home by property id: the off-market card has no listing to flip. */
export async function removeHome(
  store: StoreLike,
  propertyId: string,
  signedIn: boolean,
  notify: Notify,
): Promise<void> {
  const previous = store.getState().favorites.homes.find((h) => h.propertyId === propertyId);
  store.dispatch(unsaveEntry(propertyId));
  if (!signedIn) return;
  try {
    await unsaveHomeById(propertyId);
  } catch {
    if (!isSaved(store, propertyId) && previous) store.dispatch(saveEntry(previous));
    notify(UNSAVE_FAILED);
  }
}

let inFlight: Promise<void> | null = null;

/**
 * Makes the server the source of truth after a sign-in or a reload.
 *
 * Each home saved while signed out is sent as the listing it was saved from. The server resolves
 * the listing to its home, so two listings of one home become one save, and the client needs no
 * property mapping. Then the server's list replaces the local one. A listing the server cannot
 * save stays in the local list instead of being dropped, and the consumer is told.
 */
export function syncSavedHomes(store: StoreLike, notify: Notify): Promise<void> {
  inFlight ??= run(store, notify).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function run(store: StoreLike, notify: Notify): Promise<void> {
  const local = store.getState().favorites.homes;
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
  const current = store.getState().favorites.homes;
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
  store.dispatch(replaceSaved(merged));
  if (unsynced.length > 0) notify(SYNC_PARTIAL);
}
