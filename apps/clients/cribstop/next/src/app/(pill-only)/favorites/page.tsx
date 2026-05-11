'use client';

import { useApp } from '@/lib/context';
import ListingCard from '@/components/ListingCard';
import listings from '@/lib/listings';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function FavoritesPage() {
  const { user, savedIds } = useApp();
  const router = useRouter();

  const openModal = (mode: 'login' | 'signup') => {
    const params = new URLSearchParams(window.location.search);
    params.set('modal', mode);
    router.push(`${window.location.pathname}?${params.toString()}`);
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

  const saved = listings.filter((l) => savedIds.has(l.id));
  const suggestions = listings.filter((l) => !savedIds.has(l.id)).slice(0, 4);

  return (
    <div className="px-6 py-8 sm:px-10 lg:px-20">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight">Saved homes</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {saved.length} saved home{saved.length !== 1 ? 's' : ''} · synced to your account
          </p>
        </div>
        {saved.length > 0 && (
          <Link href="/search" className="btn-secondary">
            Find more homes
          </Link>
        )}
      </div>

      {saved.length === 0 ? (
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

          {suggestions.length > 0 && (
            <div className="mt-12 text-left">
              <p className="font-display text-lg font-bold">Suggested for you</p>
              <p className="mt-1 text-sm text-ink-muted">Popular homes in the DMV this week.</p>
              <div className="mt-5 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
                {suggestions.map((l) => (
                  <ListingCard key={l.id} listing={l} />
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {saved.map((l) => (
            <ListingCard key={l.id} listing={l} />
          ))}
        </div>
      )}
    </div>
  );
}
