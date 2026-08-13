'use client';

/**
 * Loading and error affordances the synchronous mock array never needed.
 *
 * The old data source resolved in the same tick as the render, so the app had no skeletons and no
 * fetch-failure state anywhere. Both are now real states on every listing surface.
 */

export function ListingCardSkeleton() {
  return (
    <div className="animate-pulse" aria-hidden="true">
      <div className="aspect-square rounded-md bg-surface-soft" />
      <div className="pt-2">
        <div className="h-4 w-3/5 rounded-xs bg-surface-soft" />
        <div className="mt-1.5 h-3 w-4/5 rounded-xs bg-surface-soft" />
        <div className="mt-1.5 h-4 w-2/5 rounded-xs bg-surface-soft" />
        <div className="mt-2 h-3 w-full rounded-xs bg-surface-soft" />
        <div className="mt-1 h-3 w-3/4 rounded-xs bg-surface-soft" />
      </div>
    </div>
  );
}

export function ListingGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div
      className="grid grid-cols-2 gap-x-4 gap-y-6 layout:grid-cols-3"
      role="status"
      aria-label="Loading listings"
    >
      {Array.from({ length: count }, (_, i) => (
        <ListingCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function ListingDetailSkeleton() {
  return (
    <div className="animate-pulse p-4" role="status" aria-label="Loading listing">
      <div className="aspect-[16/9] rounded-md bg-surface-soft" />
      <div className="mt-4 h-6 w-1/2 rounded-xs bg-surface-soft" />
      <div className="mt-2 h-4 w-2/3 rounded-xs bg-surface-soft" />
      <div className="mt-6 h-24 w-full rounded-md bg-surface-soft" />
    </div>
  );
}

/**
 * A user-visible failure, with a retry where retrying can help.
 *
 * A 400 from the API (a filter combination it rejects) and a 503 (the service is down) are
 * different problems and read differently to the user, so the caller passes the message it got
 * from `ListingsApiError` rather than a generic string being invented here.
 */
export function ListingErrorState({
  message,
  onRetry,
  className = '',
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div className={`rounded-md bg-surface-alt px-4 py-8 text-center ${className}`} role="alert">
      <p className="text-sm font-semibold text-ink">We couldn’t load this</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-sm bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-ink-body focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
        >
          Try again
        </button>
      )}
    </div>
  );
}

export function ListingEmptyState({
  title = 'No homes match those filters',
  hint,
}: {
  title?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-md bg-surface-alt px-4 py-12 text-center">
      <p className="text-sm font-semibold text-ink">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">{hint}</p>}
    </div>
  );
}
