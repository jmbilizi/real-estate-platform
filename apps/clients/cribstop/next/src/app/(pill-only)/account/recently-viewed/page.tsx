'use client';

import Link from 'next/link';
import { Clock } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '@/lib/context';
import { openAuthModal } from '@/lib/auth-modal';
import ListingCard from '@/components/ListingCard';
import { ActivityNotYet, ActivitySection } from '@/components/ActivitySection';
import { ListingErrorState, ListingGridSkeleton } from '@/components/listing/ListingStates';
import { getListingsByIds } from '@/lib/api/listings';
import { getRecentlyViewedIds } from '@/lib/api/recently-viewed';
import { recentlyViewedKeys } from '@/lib/query/keys';

const ERROR_MESSAGE = "We couldn't load your recently viewed homes. Please try again.";

export default function RecentlyViewedPage() {
  const { user } = useApp();

  return (
    <div className="page-gutter py-8">
      <h1 className="font-display text-3xl font-bold tracking-tight">Recently viewed</h1>
      <p className="mt-1 text-sm text-ink-muted">What you opened, newest first.</p>

      <ActivitySection id="viewed-homes" title="Homes">
        {user ? (
          <ViewedHomes account={user.email} />
        ) : (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-brand-50 px-4 py-3">
            <p className="text-sm text-ink-body">Sign in to see the homes you viewed.</p>
            <div className="flex items-center gap-2">
              <button onClick={() => openAuthModal('login')} className="btn-primary min-h-11">
                Sign in
              </button>
              <button onClick={() => openAuthModal('signup')} className="btn-secondary min-h-11">
                Create account
              </button>
            </div>
          </div>
        )}
      </ActivitySection>

      <ActivitySection id="viewed-services" title="Services">
        <ActivityNotYet>The services you view will show here when Services opens.</ActivityNotYet>
      </ActivitySection>

      <ActivitySection id="viewed-connect" title="Connect">
        <ActivityNotYet>Your Connect activity will show here when Connect opens.</ActivityNotYet>
      </ActivitySection>
    </div>
  );
}

/**
 * The cards of the listings the account opened, newest first (#366). One id read and one by-ids
 * lookup. A listing that no longer resolves is absent from the lookup, so it never shows broken.
 */
function ViewedHomes({ account }: { account: string }) {
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: recentlyViewedKeys.row(account),
    queryFn: async ({ signal }) => {
      const ids = await getRecentlyViewedIds(signal);
      return ids.length === 0 ? [] : getListingsByIds(ids, signal);
    },
    // A visit to a listing changes the list, so each visit to this page reads it again.
    staleTime: 0,
    refetchOnMount: 'always',
  });

  if (isPending) {
    return (
      <div className="mt-4">
        <ListingGridSkeleton count={4} />
      </div>
    );
  }
  if (isError) {
    return (
      <ListingErrorState className="mt-4" message={ERROR_MESSAGE} onRetry={() => void refetch()} />
    );
  }
  if (data.length === 0) {
    return (
      <div className="mt-4 rounded-3xl border border-dashed border-surface-border bg-surface-alt/60 px-6 py-12 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm">
          <Clock className="h-7 w-7 text-brand" aria-hidden="true" />
        </div>
        <p className="mt-5 font-display text-xl font-bold">No viewed homes yet</p>
        <p className="mt-1 text-sm text-ink-muted">Open a listing and it will show here.</p>
        <Link href="/homes-for-sale?type=all" className="btn-primary mt-6 inline-flex">
          Browse homes
        </Link>
      </div>
    );
  }
  return (
    <div className="mt-4 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {data.map((card, i) => (
        <div key={card.id} className="min-w-0">
          <ListingCard
            listing={card}
            track={{ listType: 'grid', rowId: 'recently-viewed', position: i }}
          />
        </div>
      ))}
    </div>
  );
}
