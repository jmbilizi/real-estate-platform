import type { ListingCardRow } from '@/lib/types';
import { getListingCard } from '@/lib/api/listings';

/**
 * Cards fetched for map pins that are not on the results page (#549). A second click on the same
 * pin reads this and does not fetch again. A card goes stale after a few minutes, which is well
 * inside how long a price or a status takes to matter. A failed fetch is never kept, so a retry
 * asks the server again.
 */
const TTL_MS = 5 * 60_000;

const cards = new Map<string, { row: ListingCardRow; at: number }>();
const inFlight = new Map<string, Promise<ListingCardRow>>();

export function peekListingCard(id: string): ListingCardRow | undefined {
  const hit = cards.get(id);
  if (!hit) return undefined;
  if (Date.now() - hit.at > TTL_MS) {
    cards.delete(id);
    return undefined;
  }
  return hit.row;
}

/** One request per id at a time. Two clicks while a fetch runs share it. */
export function loadListingCard(id: string): Promise<ListingCardRow> {
  const cached = peekListingCard(id);
  if (cached) return Promise.resolve(cached);
  const pending = inFlight.get(id);
  if (pending) return pending;
  const request = getListingCard(id)
    .then((row) => {
      cards.set(id, { row, at: Date.now() });
      return row;
    })
    .finally(() => {
      inFlight.delete(id);
    });
  inFlight.set(id, request);
  return request;
}

/** Test seam. */
export function resetListingCardCache(): void {
  cards.clear();
  inFlight.clear();
}
