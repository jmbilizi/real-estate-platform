'use client';

import { useEffect, useState } from 'react';
import { useApp } from '@/lib/context';
import ListingCard from '@/components/ListingCard';
import { getListing, type ListingDetailView, ListingsApiError } from '@/lib/api/listings';
import type { ListingCardRow } from '@/lib/types';
import { ListingErrorState, ListingGridSkeleton } from '@/components/listing/ListingStates';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const DEFAULT_ERROR_MESSAGE = "We couldn't load your saved homes. Please try again.";

/**
 * Projects a fetched detail down to the card fields `ListingCard` needs.
 *
 * The search endpoint has no ids/batch filter (unknown query params are rejected outright), so
 * favorites is the one surface that resolves N ids via N `getListing` calls and must map each
 * detail view (a flattened `{ property, unit, listing }` graph) down to the flat card shape
 * itself, rather than widening `ListingCard` to accept a second, detail-shaped prop. `primaryMedia`
 * and `openHouse` don't exist on the detail view (it carries `media[]` / `openHouses[]` instead),
 * so they're derived here — the first media item, and the first open house occurrence, matching
 * what the search endpoint itself would have projected onto a card row.
 */
function toFavoriteCardRow(detail: ListingDetailView): ListingCardRow {
  return {
    ...detail,
    primaryMedia: detail.media[0] ?? null,
    openHouse: detail.openHouses[0] ?? null,
  };
}

export default function FavoritesPage() {
  const { user, savedIds } = useApp();
  const router = useRouter();

  const [cards, setCards] = useState<ListingCardRow[]>([]);
  const [loading, setLoading] = useState(true);
  // Distinguished from "loaded zero results" (e.g. every saved id withdrew, which is a legitimate
  // empty state) — only a real failure on every request is retryable.
  const [allFailed, setAllFailed] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  const savedIdList = user ? Array.from(savedIds) : [];
  // Keyed on the sorted id list's content, not the `Set` identity, so the effect only re-fires
  // when the actual saved ids change rather than on every render of a new `Set` instance.
  const savedIdsKey = [...savedIdList].sort().join(',');

  useEffect(() => {
    if (!user || savedIdList.length === 0) {
      setCards([]);
      setLoading(false);
      setAllFailed(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setAllFailed(false);

    Promise.allSettled(savedIdList.map((id) => getListing(id, controller.signal))).then(
      (results) => {
        if (controller.signal.aborted) return;

        const fulfilledCards: ListingCardRow[] = [];
        let sawRealFailure = false;
        let firstFailureMessage: string | null = null;

        for (const result of results) {
          if (result.status === 'fulfilled') {
            fulfilledCards.push(toFavoriteCardRow(result.value));
            continue;
          }
          const err = result.reason;
          // A 404 means the listing was withdrawn since it was saved — skipped quietly, not an
          // error. Any other rejection (network, 5xx) is a real failure.
          if (err instanceof ListingsApiError && err.isNotFound) continue;
          sawRealFailure = true;
          firstFailureMessage ??= err instanceof Error ? err.message : null;
        }

        setCards(fulfilledCards);
        // "All fetches fail" means the service itself is down: nothing came back *and* at least
        // one rejection was a real failure — not just every saved listing having been withdrawn,
        // which renders as a normal empty state below rather than a retryable error.
        setAllFailed(fulfilledCards.length === 0 && sawRealFailure);
        setErrorMessage(firstFailureMessage);
        setLoading(false);
      },
    );

    return () => controller.abort();
  }, [user, savedIdsKey, retryKey]);

  const openModal = (mode: 'login' | 'signup') => {
    const params = new URLSearchParams(window.location.search);
    params.set('modal', mode);
    router.push(`${window.location.pathname}?${params.toString()}`, { scroll: false });
  };

  if (!user) {
    return (
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-50">
          <svg className="h-8 w-8 text-brand" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
          </svg>
        </div>
        <h1 className="mt-6 font-display text-2xl font-bold tracking-tight">
          Sign in to see saved homes
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          Save listings, get price alerts, and pick up where you left off — on any device.
        </p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <button onClick={() => openModal('login')} className="btn-primary">
            Sign in
          </button>
          <button onClick={() => openModal('signup')} className="btn-secondary">
            Create account
          </button>
        </div>
      </div>
    );
  }

  // While loading, show the count of ids we're resolving rather than the (still-empty) resolved
  // list — otherwise the header would flash "0 saved homes" on every visit.
  const displayCount = loading ? savedIdList.length : cards.length;

  return (
    <div className="px-6 py-8 sm:px-10 lg:px-20">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight">Saved homes</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {displayCount} saved home{displayCount !== 1 ? 's' : ''} · synced to your account
          </p>
        </div>
        {!loading && cards.length > 0 && (
          <Link href="/search" className="btn-secondary">
            Find more homes
          </Link>
        )}
      </div>

      {loading ? (
        <div className="mt-8">
          <ListingGridSkeleton count={Math.min(savedIdList.length, 8) || 4} />
        </div>
      ) : allFailed ? (
        <ListingErrorState
          className="mt-10"
          message={errorMessage ?? DEFAULT_ERROR_MESSAGE}
          onRetry={() => setRetryKey((k) => k + 1)}
        />
      ) : cards.length === 0 ? (
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
          <Link href="/search" className="btn-primary mt-6 inline-flex">
            Browse homes
          </Link>
        </div>
      ) : (
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {cards.map((l) => (
            <ListingCard key={l.id} listing={l} />
          ))}
        </div>
      )}
    </div>
  );
}
