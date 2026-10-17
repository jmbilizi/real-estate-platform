'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { saveListing, unsaveHomeById } from '@/lib/api/saved-homes';
import { useAppDispatch } from '@/lib/store/hooks';
import { addToast } from '@/lib/store/slices/toastSlice';
import {
  addEntry,
  removeEntry,
  SAVED_MUTATION_KEY,
  SAVED_MUTATION_SCOPE,
  type SavedEntry,
  savedKeys,
} from './saved-homes';

const SAVE_FAILED = "We couldn't save that home. Please try again.";
const UNSAVE_FAILED = "We couldn't remove that home. Please try again.";

export interface ToggleSavedVariables {
  entry: SavedEntry;
  /** The state after the flip. */
  save: boolean;
  signedIn: boolean;
}

/**
 * Flips a saved home. The cache changes first, so every card, map popup, detail page and modal of
 * that home changes in the same frame. `scope` runs the requests one at a time, in click order.
 * A signed-out flip stays in the cache and sends nothing. A failure undoes only this flip, not
 * later ones, and shows the toast.
 */
export function useToggleSaved() {
  const client = useQueryClient();
  const dispatch = useAppDispatch();

  return useMutation({
    mutationKey: SAVED_MUTATION_KEY,
    scope: SAVED_MUTATION_SCOPE,
    mutationFn: async ({ entry, save, signedIn }: ToggleSavedVariables) => {
      if (!signedIn) return;
      if (save) await saveListing(entry.listingId as string);
      else await unsaveHomeById(entry.propertyId);
    },
    // No `await` here: the cache must change in the same tick as the click. `revert: false` keeps
    // the cancelled fetch from restoring the list it started with.
    onMutate: ({ entry, save }) => {
      void client.cancelQueries({ queryKey: savedKeys.ids }, { revert: false });
      client.setQueryData<SavedEntry[]>(savedKeys.ids, (old) =>
        save ? addEntry(old, entry) : removeEntry(old, entry.propertyId),
      );
    },
    onError: (_error, { entry, save }) => {
      client.setQueryData<SavedEntry[]>(savedKeys.ids, (old) =>
        save ? removeEntry(old, entry.propertyId) : addEntry(old, entry),
      );
      dispatch(
        addToast({
          id: `saved-${Date.now()}`,
          message: save ? SAVE_FAILED : UNSAVE_FAILED,
          type: 'error',
          duration: 5000,
        }),
      );
    },
    onSettled: (_data, _error, { signedIn }) => {
      // Refetch only after the last queued toggle, so a stale list cannot undo a later flip.
      if (!signedIn || client.isMutating({ mutationKey: SAVED_MUTATION_KEY }) > 1) return;
      return client.invalidateQueries({ queryKey: savedKeys.all });
    },
  });
}
