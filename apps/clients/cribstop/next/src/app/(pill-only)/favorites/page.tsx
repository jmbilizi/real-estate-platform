'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { savedKeys } from '@/lib/query/saved-homes';
import { useApp } from '@/lib/context';
import { openAuthModal } from '@/lib/auth-modal';
import ListingCard from '@/components/ListingCard';
import OffMarketHomeCard from '@/components/OffMarketHomeCard';
import { getListing, type ListingDetailView, ListingsApiError } from '@/lib/api/listings';
import { listAllSavedHomes } from '@/lib/api/saved-homes';
import type { SavedHome } from '@cribstop/property-contracts';
import type { ListingCardRow } from '@/lib/types';
import { ListingErrorState, ListingGridSkeleton } from '@/components/listing/ListingStates';
import Link from 'next/link';

const DEFAULT_ERROR_MESSAGE = "We couldn't load your saved homes. Please try again.";

/**
 * Projects a fetched detail down to the card fields `ListingCard` needs.
 *
 * Only the signed-out path uses this. A signed-out visitor has no saved-homes list on the server,
 * so the page resolves each locally saved listing with one `getListing` call (bounded card-row
 * lookup by id set is #76). A signed-in visitor gets home-shaped rows from `GET /saved-homes`.
 * `primaryMedia` and `openHouse` do not exist on the detail view, so they come from the first
 * `media` and `openHouses` entries, the same projection the search endpoint makes.
 */
function toFavoriteCardRow(detail: ListingDetailView): ListingCardRow {
  return {
    ...detail,
    propertyId: detail.subjectId,
    primaryMedia: detail.media[0] ?? null,
    openHouse: detail.openHouses[0] ?? null,
  };
}

/** A card to draw: a listed home, or an off-market home (`listing: null`, #23). */
type FavoriteItem =
  | { kind: 'listed'; propertyId: string; card: ListingCardRow }
  | { kind: 'off-market'; propertyId: string; home: SavedHome };

export default function FavoritesPage() {
  const { user, savedHomes, savedPropertyIds, removeSaved, adoptSaved } = useApp();

  // A signed-out visitor's list is the local cache. Keyed on its content so the query runs when
  // the saved set changes, not on every new array identity.
  const localListingIds = savedHomes.flatMap((h) => (h.listingId ? [h.listingId] : []));
  const localKey = [...localListingIds].sort().join(',');
  const signedIn = user !== null;
  // A signed-out visitor with nothing saved has nothing to fetch, so the empty state shows at once.
  const idle = !signedIn && localListingIds.length === 0;

  const {
    data: items = [],
    isPending,
    isError: failed,
    error,
    refetch,
  } = useQuery({
    queryKey: savedKeys.page(signedIn, localKey),
    enabled: !idle,
    queryFn: async ({ signal }): Promise<FavoriteItem[]> => {
      if (signedIn) {
        const homes = await listAllSavedHomes(signal);
        // The list is the server's truth. Adopt it, so the list is not filtered out by a cache
        // that the sign-in sync has not filled yet.
        adoptSaved(
          homes.map((h) => ({ propertyId: h.propertyId, listingId: h.savedFromListingId })),
        );
        return homes.map((home) =>
          home.listing
            ? { kind: 'listed', propertyId: home.propertyId, card: home.listing }
            : { kind: 'off-market', propertyId: home.propertyId, home },
        );
      }
      const results = await Promise.allSettled(localListingIds.map((id) => getListing(id, signal)));
      const next: FavoriteItem[] = [];
      let realFailure: unknown = null;
      for (const result of results) {
        if (result.status === 'fulfilled') {
          const card = toFavoriteCardRow(result.value);
          next.push({ kind: 'listed', propertyId: card.propertyId, card });
          continue;
        }
        // A withdrawn listing is skipped quietly. Any other rejection is a real failure.
        const err = result.reason;
        if (err instanceof ListingsApiError && err.isNotFound) continue;
        realFailure ??= err;
      }
      // Distinguished from "loaded zero results" (a legitimate empty state): only a real failure
      // with nothing to show is retryable.
      if (next.length === 0 && realFailure !== null) throw realFailure;
      return next;
    },
  });
  const loading = isPending && !idle;
  const errorMessage = error instanceof Error ? error.message : null;

  // An unsave drops the card at once and a rollback brings it back, because the store is the truth.
  const visible = useMemo(
    () => items.filter((item) => savedPropertyIds.has(item.propertyId)),
    [items, savedPropertyIds],
  );

  const openModal = (mode: 'login' | 'signup') => {
    openAuthModal(mode);
  };

  // While loading, show the count the store holds rather than the still-empty list, so the header
  // does not flash "0 saved homes" on every visit.
  const displayCount = loading ? savedHomes.length : visible.length;

  return (
    <div className="px-6 py-8 sm:px-10 lg:px-20">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight">Saved homes</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {displayCount} saved home{displayCount !== 1 ? 's' : ''} ·{' '}
            {signedIn ? 'synced to your account' : 'saved on this device for now'}
          </p>
        </div>
        {!loading && visible.length > 0 && (
          <Link href="/homes-for-sale?type=all" className="btn-secondary">
            Find more homes
          </Link>
        )}
      </div>

      {!signedIn && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-brand-50 px-4 py-3">
          <p className="text-sm text-ink-body">
            Sign in to keep your saved homes and see them on any device.
          </p>
          <div className="flex items-center gap-2">
            <button onClick={() => openModal('login')} className="btn-primary">
              Sign in
            </button>
            <button onClick={() => openModal('signup')} className="btn-secondary">
              Create account
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="mt-8">
          <ListingGridSkeleton count={Math.min(savedHomes.length, 8) || 4} />
        </div>
      ) : failed ? (
        <ListingErrorState
          className="mt-10"
          message={errorMessage ?? DEFAULT_ERROR_MESSAGE}
          onRetry={() => void refetch()}
        />
      ) : visible.length === 0 ? (
        <div className="mt-10 rounded-3xl border border-dashed border-surface-border bg-surface-alt/60 px-6 py-16 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm">
            <svg
              className="h-7 w-7 text-brand"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
              />
            </svg>
          </div>
          <p className="mt-5 font-display text-xl font-bold">No saved homes yet</p>
          <p className="mt-1 text-sm text-ink-muted">
            Tap the heart on any listing and it will appear here for easy access.
          </p>
          <Link href="/homes-for-sale?type=all" className="btn-primary mt-6 inline-flex">
            Browse homes
          </Link>
        </div>
      ) : (
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {/* min-w-0: a grid item's min width is its content, so a truncated address would widen the
              single mobile column and scroll the page sideways. */}
          {visible.map((item, i) => (
            <div key={item.propertyId} className="min-w-0" data-favorite-cell>
              {item.kind === 'listed' ? (
                <ListingCard
                  listing={item.card}
                  track={{ listType: 'favorites', rowId: 'favorites', position: i }}
                />
              ) : (
                <OffMarketHomeCard home={item.home} onRemove={removeSaved} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
