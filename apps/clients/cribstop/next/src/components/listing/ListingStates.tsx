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

/**
 * Mirrors the loaded detail layout — header bar, gallery panel, then the two-column stack of
 * panels — rather than approximating it with three loose blocks.
 *
 * The point of a skeleton is that nothing jumps when the data lands. A skeleton whose shape
 * disagrees with the real page is a worse lie than no skeleton: it promises one layout and
 * delivers another. Same panel primitive, same gutter, same canvas as `ListingDetailContent`.
 */
export function ListingDetailSkeleton() {
  const panel = 'rounded-2xl border border-surface-border bg-white';

  return (
    <div className="flex h-full min-h-0 flex-col" role="status" aria-label="Loading listing">
      {/*
       * Header bar, matching the loaded page's back / address / actions row.
       *
       * The title and subtitle placeholders carry the **same type classes** as the real `h1` and
       * `p` and are filled with a non-breaking space, so their boxes are set by the type scale
       * rather than by a guessed pixel height. Sized by hand (`h-4`/`h-3`) this header measured
       * 73px against the loaded header's 81px, and every element below jumped 8px the instant the
       * data landed — against a modal whose rounded corners stay put, which reads as the border
       * itself flickering. Tying the boxes to the type scale keeps them equal at every breakpoint,
       * including the ones this header changes size at (`sm`/`md`/`lg`/`xl`).
       */}
      <div className="flex flex-shrink-0 animate-pulse items-center gap-3 border-b border-surface-border bg-white px-6 pb-3 pt-4 sm:px-8">
        <div className="h-11 w-11 flex-shrink-0 rounded-full bg-surface-soft" />
        <div className="min-w-0 flex-1">
          {/* `block`, not `inline-block`: an inline-block sits on the text baseline and reserves
              descender space below it, which made this header 86px against the real 81px. As a
              block the placeholder's height is exactly the inherited line-height — the same box
              the real text occupies. */}
          <h1 className="text-base font-semibold tracking-tight">
            <span className="block w-2/5 rounded-xs bg-surface-soft">&nbsp;</span>
          </h1>
          <p className="mt-1 text-sm">
            <span className="block w-1/4 rounded-xs bg-surface-soft">&nbsp;</span>
          </p>
        </div>
        <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
          <div className="h-10 w-24 rounded-full bg-surface-soft" />
          <div className="h-10 w-24 rounded-full bg-surface-soft" />
        </div>
      </div>

      {/* `min-h-0` so the body fits the panel and scrolls like the loaded one. Without it this
          measured 999px inside a 750px panel and was simply clipped. */}
      {/* Same scroll classes as the loaded body. With `overflow-hidden` the skeleton had no
          scrollbar while the loaded page did, so the content column was 10px wider during load. */}
      <div className="scrollbar-overlay min-h-0 flex-1 animate-pulse bg-surface-alt px-6 py-4 pb-8 sm:px-8">
        {/*
         * The gallery's real shape: `aspect-video` on mobile, a fixed 480px grid from `md` up —
         * see `PropertyGallery`. This was `aspect-[16/9]` at every width, which is right on mobile
         * and wrong on desktop: it stood 551px tall against the real gallery's 482px, so the whole
         * page jumped 70px upwards the moment the photos arrived. The photo block is the tallest
         * thing on the page, so getting its shape wrong moves everything below it.
         *
         * Written out rather than `${panel} bg-surface-soft`: both fills are the same specificity,
         * so which one wins is decided by stylesheet order, not by the order written here.
         */}
        <div className="overflow-hidden rounded-2xl border border-surface-border">
          <div className="aspect-video bg-surface-soft md:aspect-auto md:h-[480px]" />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_380px] lg:items-start">
          <div className="space-y-4">
            {/* Price panel */}
            <div className={`${panel} p-6`}>
              <div className="h-5 w-24 rounded-full bg-surface-soft" />
              <div className="mt-3 h-9 w-1/2 rounded-xs bg-surface-soft" />
              <div className="mt-2 h-4 w-1/3 rounded-xs bg-surface-soft" />
            </div>
            {/* Stats panel */}
            <div className={`h-20 ${panel}`} />
            {/* Description panel */}
            <div className={`${panel} p-6`}>
              <div className="h-5 w-40 rounded-xs bg-surface-soft" />
              <div className="mt-4 h-3 w-full rounded-xs bg-surface-soft" />
              <div className="mt-2 h-3 w-11/12 rounded-xs bg-surface-soft" />
              <div className="mt-2 h-3 w-4/5 rounded-xs bg-surface-soft" />
            </div>
          </div>

          <div className="space-y-4">
            <div className={`h-64 ${panel}`} />
            <div className={`h-32 ${panel}`} />
          </div>
        </div>
      </div>

      {/* The loaded page has a sticky CTA bar below `lg`. Without a placeholder of the same height
          the mobile layout shifts on load the same way the header did on desktop. */}
      <div className="flex flex-shrink-0 animate-pulse items-center justify-between gap-3 border-t border-surface-border bg-white px-4 py-3 lg:hidden">
        <div className="h-7 w-28 rounded-xs bg-surface-soft" />
        <div className="flex shrink-0 gap-2">
          <div className="h-9 w-24 rounded-full bg-surface-soft" />
          <div className="h-9 w-28 rounded-full bg-surface-soft" />
        </div>
      </div>
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
