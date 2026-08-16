'use client';

/**
 * Loading and error affordances the synchronous mock array never needed.
 *
 * The old data source resolved in the same tick as the render, so the app had no skeletons and no
 * fetch-failure state anywhere. Both are now real states on every listing surface.
 */

import type { ListingCardRow } from '@/lib/types';

/**
 * The one fill for anything standing in for content, everywhere in this file.
 *
 * The distinction that matters, and the one that was got wrong: a **container** takes the loaded
 * page's own surface, because the skeleton's job is to reproduce the loaded layout — the detail
 * page's panels are white cards on a `surface-alt` canvas, and a skeleton that made them grey would
 * be promising a layout it does not deliver. A **placeholder block** — a thing standing in for
 * content that has not arrived — is always this fill.
 *
 * Painting a placeholder white breaks that: the stats, agent and mortgage stand-ins were bare
 * `h-20`/`h-64`/`h-32` white panels, which read as *empty panels the listing genuinely has nothing
 * to put in* rather than as content on its way. They are now panel shells with this fill inside
 * them, which is what the rest of the file was already doing.
 */
const FILL = 'bg-surface-soft';

/**
 * A placeholder line whose height comes from the type class it is written inside, not from a
 * guessed pixel value.
 *
 * `block` + `&nbsp;` makes the box exactly one line box of whatever the parent's type scale is, so
 * a heading placeholder inside an `h2` measures what that `h2` will measure. Sizing these by hand
 * is what once left the header 8px short of the loaded one at every breakpoint.
 */
function Bar({ className = '' }: { className?: string }) {
  return (
    <span className={`relative block ${className}`}>
      &nbsp;
      {/* The visible bar is inset inside the line box rather than filling it. Stacked lines of
          placeholder text are contiguous line boxes, so a fill that covered them whole merged into
          one grey slab; insetting leaves the gap real text has without adding any height. */}
      <span
        className={`absolute inset-x-0 top-1/2 h-[0.7em] -translate-y-1/2 rounded-xs ${FILL}`}
      />
    </span>
  );
}

/**
 * The width of one card in a horizontally-scrolling row.
 *
 * Defined here, and imported by `ListingRow`, because the row's skeleton and the row itself must be
 * the same width at every breakpoint or the panel resizes when the cards arrive. It lived in
 * `ListingRow` and the skeleton carried a truncated copy that stopped at `md`, so above that
 * breakpoint the placeholders were cards-per-row too few, hence too wide, hence too tall: the
 * similar-homes panel measured 468px against the loaded 391px and shrank on load. `ListingRow`
 * already imports this module, so the class lives on this side of that dependency.
 */
export const CARD_WIDTH_CLASS =
  'w-[calc((100%-1.25rem)/2)] flex-shrink-0 snap-start [scroll-snap-stop:always] sm:w-[calc((100%-2.5rem)/3)] md:w-[calc((100%-3.75rem)/4)] lg:w-[calc((100%-5rem)/5)] xl:w-[calc((100%-6.25rem)/6)] 2xl:w-[calc((100%-7.5rem)/7)]';

/**
 * A card placeholder built on `ListingCard`'s own reserved slots.
 *
 * The card reserves a box for each variable row — the label row, the stats line, the attribution
 * block — precisely so that every tile in a grid is the same height. This mirrors those slots with
 * the same elements and type classes rather than approximating them with five loose bars, which
 * measured 26px short per card; across a row of them the similar-homes panel grew on load.
 */
export function ListingCardSkeleton() {
  return (
    <div className="animate-pulse" aria-hidden="true">
      <div className={`aspect-square rounded-md ${FILL}`} />
      <div className="pt-2">
        {/* The required-label slot, reserved and empty — the same box a row with no labels gets. */}
        <div className="mb-1 h-5" />
        <h3 className="truncate text-sm font-medium">
          <Bar className="w-3/5" />
        </h3>
        <p className="h-[18px] text-[13px] leading-[18px]">
          <Bar className="w-4/5" />
        </p>
        <p className="mt-0.5 text-base">
          <Bar className="w-2/5" />
        </p>
        {/* Attribution keeps its own tinted block: a container, so it takes the loaded surface. */}
        <div className="mt-1 rounded-sm bg-surface-alt px-1.5 py-1 text-[13px]">
          <Bar className="w-3/4" />
        </div>
      </div>
    </div>
  );
}

/**
 * The similar-homes carousel while its own request is in flight.
 *
 * Lives here rather than in `ListingDetailContent` because two different states need the identical
 * block and they must not drift: the detail page renders it while `similar` is loading, and the
 * detail *skeleton* renders it because the carousel is a section of the page like any other. A
 * second hand-built copy in the skeleton would have been one more thing to keep in step by hand.
 */
export function SimilarHomesSkeleton() {
  return (
    <section className="px-6 py-6" aria-hidden="true">
      {/* `ListingRow`'s heading block: a column with its own bottom padding, not a bare bar. */}
      <div className="flex flex-col gap-1 pb-1">
        <div className={`h-7 w-40 rounded-xs ${FILL}`} />
      </div>
      {/* `pb-3` matches the row's scroll container, which reserves room for its scrollbar. */}
      <div className="mt-4 flex gap-5 overflow-x-hidden pb-3">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className={CARD_WIDTH_CLASS}>
            <ListingCardSkeleton />
          </div>
        ))}
      </div>
    </section>
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
 *
 * ## `layoutRow` — a shape, never content
 *
 * This state is **uniformly skeletal**: no listing data is drawn in it, whichever way the panel was
 * opened. An earlier version filled the header and the gallery's large cell with the clicked card's
 * real address, price and primary photo, on the reasoning that a card click already has them. That
 * is not what a loading state should look like — half-real and half-grey reads as a broken render
 * rather than as a page arriving, and it made the swap to the loaded page a series of small
 * substitutions instead of one clean transition. Product decided against it; the panel now loads the
 * same way from a card click, a map pin and a cold URL.
 *
 * What survives is the *use of the row for measurement*. `layoutRow` decides **which boxes to
 * reserve**, never what to draw in them:
 *
 * - whether the mortgage estimate is reserved at all (the loaded page renders it only for a sale
 *   with a price, so reserving it for a rental would hold space for a panel that never comes);
 * - how many amenity chips to reserve, which sets that section's height and therefore the offset of
 *   everything below it;
 * - whether the gallery is the mosaic or the single block a listing with no media gets.
 *
 * Nothing else reads it, and a test asserts that none of the row's text ever reaches the DOM. Every
 * placeholder is sized from the loaded page's own type classes rather than by hand — sized by hand
 * this header measured 73px against the real 81px and everything below it jumped 8px on load.
 */
export function ListingDetailSkeleton({ layoutRow }: { layoutRow?: ListingCardRow }) {
  const panel = 'rounded-2xl border border-surface-border bg-white';

  /*
   * One pulse, on the containers. Everything inside them is a placeholder now, so there is no real
   * content for the animation to breathe in and out — which is why it had to move onto the
   * individual blocks while the header and gallery carried real data.
   */
  const pulse = 'animate-pulse';

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
      <div
        className={`flex flex-shrink-0 items-center gap-3 border-b border-surface-border bg-white px-6 pb-3 pt-4 sm:px-8 ${pulse}`}
      >
        <div className={`h-11 w-11 flex-shrink-0 rounded-full ${FILL}`} />
        <div className="min-w-0 flex-1">
          {/* The placeholders stay *inside* the real `h1` and `p`, so their boxes come from the
              type scale rather than from a guessed height. Sized by hand (`h-4`/`h-3`) this header
              measured 73px against the loaded 81px and everything below it jumped 8px on load —
              against a modal whose corners stay put, which reads as the border flickering. */}
          <h1 className="truncate text-base font-semibold tracking-tight text-ink">
            <Bar className="w-2/5" />
          </h1>
          <p className="mt-1 truncate text-sm text-ink-muted">
            <Bar className="w-1/4" />
          </p>
        </div>
        <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
          <div className={`h-10 w-24 rounded-full ${FILL}`} />
          <div className={`h-10 w-24 rounded-full ${FILL}`} />
        </div>
      </div>

      {/* `min-h-0` so the body fits the panel and scrolls like the loaded one. Without it this
          measured 999px inside a 750px panel and was simply clipped. */}
      {/* Same scroll classes as the loaded body. With `overflow-hidden` the skeleton had no
          scrollbar while the loaded page did, so the content column was 10px wider during load. */}
      <div
        className={`scrollbar-overlay min-h-0 flex-1 bg-surface-alt px-6 py-4 pb-8 sm:px-8 ${pulse}`}
      >
        {/*
         * The gallery, in the same bordered panel the loaded page wraps `PropertyGallery` in, so
         * the block measures 482px at `md` and up in both states. Getting this shape wrong is the
         * most expensive mistake on the page: it is the tallest thing below the header, and an
         * early version at `aspect-[16/9]` on every width stood 551px against the real 482px, so
         * everything under it jumped 70px when the photos arrived.
         *
         * `PropertyGallery` has two layouts and this mirrors both:
         *
         * - **Below `md`** it is a single `aspect-video` image, whatever the photo count.
         * - **From `md` up** it is the 4x2 mosaic — one `col-span-2 row-span-2` cell and four
         *   tiles. Five is not a guess about how many photos exist: the gallery pads to five by
         *   repeating (`i % media.length`), so a one-photo listing still renders five.
         *
         * The single exception is a listing with no media at all, whose loaded gallery is one
         * branded placeholder rather than a mosaic. Only `layoutRow` can know that, which is one of
         * the three things it is still consulted for.
         */}
        <div className={`overflow-hidden ${panel}`} data-skeleton-section="gallery">
          {layoutRow && !layoutRow.primaryMedia ? (
            /* The one listing whose loaded gallery really is a single block. */
            <div className={`aspect-video ${FILL} md:aspect-auto md:h-[480px]`} />
          ) : (
            <>
              {/* Below `md` the loaded gallery is one `aspect-video` image, whatever the count. */}
              <div className={`aspect-video w-full ${FILL} md:hidden`} />
              {/* From `md` up, the 4x2 mosaic: a `col-span-2 row-span-2` cell and four tiles. */}
              <div className="hidden md:grid md:h-[480px] md:grid-cols-4 md:grid-rows-2 md:gap-2 md:overflow-hidden">
                <div
                  className={`col-span-2 row-span-2 overflow-hidden ${FILL}`}
                  data-gallery-tile-placeholder
                />
                {Array.from({ length: 4 }, (_, i) => (
                  <div
                    key={i}
                    className={`overflow-hidden ${FILL}`}
                    data-gallery-tile-placeholder
                  />
                ))}
              </div>
            </>
          )}
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_380px] lg:items-start">
          <div className="space-y-4">
            {/*
             * Price panel: the status/disclosure badge row, the price, the location line.
             *
             * No disclosure label is rendered here, and that is the correct reading of the rule
             * rather than an omission. `isSample` is owed "on every surface a sample row appears
             * on" and `sponsored` "wherever it renders" — this surface now renders no part of the
             * row at all, so there is nothing being disclosed about and a `SAMPLE DATA` chip on a
             * blank panel would be labelling nothing. The labels attach the instant the row does,
             * in `ListingDetailContent`, which carries both. What would be a violation is the
             * reverse: showing the row's address and price here without them, which is exactly what
             * this state no longer does.
             */}
            <div className={`${panel} p-6`} data-skeleton-section="price">
              <div className={`h-5 w-24 rounded-full ${FILL}`} />
              <div className={`mt-3 h-9 w-1/2 rounded-xs ${FILL}`} />
              <div className={`mt-2 h-4 w-1/3 rounded-xs ${FILL}`} />
            </div>
            {/*
             * Stats tiles. A shell with the tiles' own grid rather than a bare `h-20` card: the
             * loaded strip is six bordered cells, so an empty white box of the same height read as
             * a panel this listing had nothing to put in.
             */}
            <div
              className={`grid grid-cols-2 gap-0 overflow-hidden ${panel} sm:grid-cols-3 lg:grid-cols-6`}
              data-skeleton-section="stats"
            >
              {Array.from({ length: 6 }, (_, i) => (
                <div
                  key={i}
                  className={`px-5 py-4 ${i !== 5 ? 'border-b border-surface-border sm:border-b-0 sm:border-r' : ''}`}
                >
                  <p className="text-[11px] font-semibold uppercase tracking-wider">
                    <Bar className="w-12" />
                  </p>
                  <p className="mt-1 text-base font-semibold">
                    <Bar className="w-10" />
                  </p>
                </div>
              ))}
            </div>

            {/* "About this home" — detail-only text, absent from a card row by design. */}
            <div className={`${panel} p-6`} data-skeleton-section="description">
              <h2 className="text-xl font-semibold tracking-tight">
                <Bar className="w-44" />
              </h2>
              <p className="mt-3 leading-relaxed">
                <Bar />
                <Bar className="w-11/12" />
                <Bar className="w-4/5" />
              </p>
            </div>

            {/*
             * "Features & amenities". The chip *count* comes from the row when there is one —
             * amenities are a card field, not a detail-only one — so the block reserves the height
             * the real chips will need. Their labels are not guessed: each chip is a placeholder
             * until the detail lands.
             */}
            <div className={`${panel} p-6`} data-skeleton-section="amenities">
              <h2 className="text-xl font-semibold tracking-tight">
                <Bar className="w-56" />
              </h2>
              <div className="mt-4 flex flex-wrap gap-2">
                {Array.from(
                  { length: layoutRow ? Math.min(layoutRow.amenities.length, 12) || 8 : 8 },
                  (_, i) => (
                    /*
                     * `&nbsp;` sets the line box from `text-sm`, exactly as `AmenityChips` gets its
                     * height from its label; the width comes from a class rather than from dummy
                     * text. It carried the literal word "Placeholder" hidden with `invisible`, which
                     * was inert to the eye but real text inside a `role="status"` live region.
                     * Widths alternate so a row of chips does not read as a single bar.
                     */
                    <span
                      key={i}
                      className={`inline-flex items-center rounded-full border border-surface-border px-3 py-1.5 text-sm ${FILL} ${
                        ['w-24', 'w-32', 'w-20', 'w-28'][i % 4]
                      }`}
                    >
                      &nbsp;
                    </span>
                  ),
                )}
              </div>
            </div>

            {/*
             * "Where you'll live". The map box is reserved at the loaded map's exact `h-[380px]`,
             * inside the same square-edged hairline, because this is the tallest thing below the
             * gallery — leaving it out moved every section under it by half a screen.
             *
             * It deliberately stays a plain block rather than mounting `SingleListingMap` early:
             * that component is mount-gated `next/dynamic`, so it has its own loading beat *after*
             * the detail lands, and starting it here would fetch leaflet for a panel that may be
             * closed a second later. Its own placeholder fills the same box when it does mount.
             */}
            <div className={`${panel} p-6`} data-skeleton-section="map">
              <h2 className="text-xl font-semibold tracking-tight">
                <Bar className="w-48" />
              </h2>
              <p className="mt-2 text-sm">
                <Bar className="w-40" />
              </p>
              <div className="mt-4 overflow-hidden border border-surface-border">
                <div className={`h-[380px] w-full ${FILL}`} />
              </div>
            </div>

            {/* Listing disclosure — attribution and provenance, both detail-only. */}
            <div
              className={`${panel} p-6 text-[13px] leading-relaxed`}
              data-skeleton-section="disclosure"
            >
              <Bar className="w-2/3" />
              <Bar className="mt-2 w-1/2" />
              <Bar className="mt-2 w-3/4" />
            </div>
          </div>

          {/* Sidebar — agent card, then the mortgage estimate. */}
          <div className="space-y-4">
            {/* Listing agent: label, avatar row, three contact lines, two buttons. */}
            <div className={`${panel} p-6`} data-skeleton-section="agent">
              <p className="text-[11px] font-semibold uppercase tracking-wider">
                <Bar className="w-24" />
              </p>
              <div className="mt-3 flex items-center gap-3">
                <div className={`h-12 w-12 flex-shrink-0 rounded-full ${FILL}`} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    <Bar className="w-2/3" />
                  </p>
                  <p className="text-[13px]">
                    <Bar className="mt-1 w-1/2" />
                  </p>
                </div>
              </div>
              {/* Four contact rows, not three: the loaded card lists agent phone, agent email,
                  office phone and office email. Counted from the rendered card, not guessed. */}
              <div className="mt-4 space-y-1.5 text-sm">
                <Bar className="w-3/4" />
                <Bar className="w-4/5" />
                <Bar className="w-2/3" />
                <Bar className="w-3/5" />
              </div>
              {/* `btn-primary` measures 40px and `btn-secondary` 42px — they are not the same
                  height, and averaging them left this card 12px short of the loaded one. */}
              <div className={`mt-5 h-10 w-full rounded-full ${FILL}`} />
              <div className={`mt-2 h-[42px] w-full rounded-full ${FILL}`} />
            </div>

            {/*
             * The mortgage estimate, which the loaded page renders only for a sale with a price.
             * With a row in hand that is knowable, so it is reserved exactly when it will appear;
             * without one it is reserved anyway, because it is the last thing in its own column and
             * being wrong about it moves nothing. `bg-brand-50/50` because a container matches the
             * loaded surface — this panel is tinted, and a white one would flash to tint on load.
             */}
            {(!layoutRow || (layoutRow.listingType === 'sale' && layoutRow.price !== null)) && (
              <div
                className="rounded-2xl border border-surface-border bg-brand-50/50 p-6"
                data-skeleton-section="mortgage"
              >
                <p className="text-base font-semibold">
                  <Bar className="w-3/5" />
                </p>
                <p className="mt-2 text-xl font-semibold">
                  <Bar className="w-2/5" />
                </p>
                <div className="mt-3 space-y-1 text-sm">
                  <Bar className="w-4/5" />
                  <Bar className="w-3/5" />
                </div>
                <p className="mt-3 text-xs">
                  <Bar className="w-full" />
                </p>
              </div>
            )}
          </div>
        </div>

        {/*
         * Similar homes closes the stack, as it does on the loaded page — and it is reserved here
         * even though the carousel has its own request, because that request does not start until
         * the detail has landed. Without this block the panel grew by ~390px twice: once when the
         * detail arrived, again when the carousel did.
         *
         * The same component the loaded page shows while that request is in flight, so the two
         * states are the same block rather than two guesses at it.
         */}
        <div className={`mt-4 ${panel}`} data-skeleton-section="similar-homes">
          <SimilarHomesSkeleton />
        </div>
      </div>

      {/* The loaded page has a sticky CTA bar below `lg`. Without a placeholder of the same height
          the mobile layout shifts on load the same way the header did on desktop. */}
      <div
        className={`flex flex-shrink-0 items-center justify-between gap-3 border-t border-surface-border bg-white px-4 py-3 lg:hidden ${pulse}`}
      >
        <div className={`h-7 w-28 rounded-xs ${FILL}`} />
        <div className="flex shrink-0 gap-2">
          <div className={`h-9 w-24 rounded-full ${FILL}`} />
          <div className={`h-9 w-28 rounded-full ${FILL}`} />
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
