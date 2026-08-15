'use client';

import type { ListingCardRow } from '@/lib/types';
import { useApp } from '@/lib/context';
import { openListingPanel } from '@/lib/listing-panel';
import {
  formatClosePrice,
  formatDwellingStats,
  formatListingLocation,
  formatListingPrice,
  formatLotSize,
  formatOpenHouseBadge,
  formatOpenHouseDate,
} from '@/lib/listing-format';
import ListingAttribution from '@/components/listing/ListingAttribution';
import ListingImage from '@/components/listing/ListingImage';
import { SampleBadge, SponsoredBadge } from '@/components/listing/ListingBadges';

export default function ListingCard({ listing }: { listing: ListingCardRow }) {
  const { toggleSave, isSaved } = useApp();
  const saved = isSaved(listing.id);

  /**
   * Opens the detail panel on this row, on the click, with no network in the way.
   *
   * This has been through two designs that both put a request between the click and the first
   * frame. It pushed `?listing=<id>` and let a listener in the root layout read it, which meant the
   * modal could not exist until hydration. Then it pushed `/listing/<id>` for
   * `@modal/(.)listing/[id]` to intercept, with a `loading.tsx` to cover the gap — but a loading
   * boundary belongs to the segment it sits in, so the browser had to fetch that segment's RSC
   * payload *and* its chunk before it could draw anything. Measured on the search page: 519ms from
   * click to skeleton, of which the first 451ms was the payload alone, and the hover prefetch meant
   * to hide it does nothing in `next dev` and never fires for a tap or a keypress.
   *
   * Neither round trip bought anything: the intercepted route resolved no data. So the open is now
   * local state — see `lib/listing-panel` — and the whole row goes with it, which is what lets the
   * panel open on this listing's own address, badges, price and photo instead of on grey blocks.
   */
  const openPanel = () => openListingPanel(listing.id, listing);

  const isSold = listing.listingType === 'sold' || listing.status === 'Sold';
  const isParcel = listing.propertyType === 'Land';

  /**
   * A parcel has no dwelling to describe, so lot size replaces the bed/bath/sqft triplet — that is
   * what a consumer scanning parcels needs and what every incumbent shows for land. Everything
   * else falls back to whichever parts of the triplet the API actually sent.
   */
  const statsLine = isParcel
    ? formatLotSize(listing.lotSqft)
    : formatDwellingStats(listing.beds, listing.baths, listing.sqft);

  const price = formatListingPrice(listing.price, listing.listingType);
  const soldLine = isSold ? formatClosePrice(listing.closePrice, listing.closeDate) : null;

  /**
   * Open house is a pill in the top-left stack, with its date and time on the row beneath it.
   *
   * Three shapes have been tried and each failed on one of two things — card height, or the date.
   * A card once carried three separate affordances, including a full date/time **text row below the
   * image**: that row was the only one open-house cards had and other cards did not, so tiles in a
   * grid came out different heights. Collapsing it into a single corner pill fixed the height and
   * cost the date, and "Open Sat" does not say *which* Saturday — for an open house that is a
   * wasted trip to a house. A full-width band across the foot of the image kept both, but put a
   * gradient scrim over the photo to stay legible.
   *
   * This keeps both and drops the scrim: two rows in the same top-left stack as the marketing pill,
   * inside the fixed-aspect image, so the card height is untouched and the whole statement fits.
   *
   * A **sold** row never shows one. The API only sends upcoming occurrences, but a sold listing
   * with one would be actively misleading, so the sold ribbon wins outright.
   */
  const openHouse = !isSold && listing.openHouse ? listing.openHouse : null;

  /**
   * The marketing pill shares the top-left stack with open house rather than contending for one
   * slot — it takes the top row when both are present. The required disclosure labels (sample,
   * sponsored) are not in this rotation and never have been: they have their own guaranteed row
   * below the image, because a marketing badge must never be able to displace a label that has to
   * be shown.
   */
  const marketingBadge = listing.priceReduced
    ? 'Price reduced'
    : listing.newConstruction
      ? 'New construction'
      : listing.featured
        ? 'Featured'
        : null;

  return (
    /*
     * `role="link"` with a key handler rather than a bare `onClick` div: the card was reachable by
     * mouse and touch only, so a keyboard user could not open a listing at all. It is not a real
     * `<a>` because the save control is a `<button>` inside this box, and interactive content
     * nested in an anchor is invalid HTML — the accessible-name and focus behaviour of the pair
     * stops being defined. Enter and Space both activate, which is what a link and a button
     * respectively lead a user to try.
     */
    <div
      role="link"
      tabIndex={0}
      aria-label={`View listing in ${formatListingLocation(listing.neighborhood, listing.city, listing.state)}`}
      className="group block cursor-pointer rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
      onClick={openPanel}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        // Space scrolls the page by default, which would move the results out from under the panel
        // that is about to open over them.
        e.preventDefault();
        openPanel();
      }}
    >
      {/* Image. `listing-card-media` makes this the container the open-house badge measures. */}
      <div className="listing-card-media relative aspect-square overflow-hidden rounded-md bg-surface-soft">
        <ListingImage
          media={listing.primaryMedia}
          className={`h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04] ${
            isSold ? 'opacity-75 saturate-50' : ''
          }`}
        />

        {/* Sold inventory reads differently from live inventory at a glance. */}
        {isSold && (
          <span className="absolute inset-x-0 top-0 bg-ink/85 py-1 text-center text-[11px] font-semibold uppercase tracking-wide text-white">
            Sold
          </span>
        )}

        {/*
         * The image's badge stack: marketing pill, then open house, then its date and time.
         *
         * **One positioned container holding all of them**, rather than each badge placing itself.
         * A listing can be Featured *and* have an open house, so as separate absolutes they would
         * have needed hand-computed `top` offsets that stayed correct for every combination — the
         * kind of arithmetic that is right when written and wrong after the next addition. Stacked
         * in a flex column they cannot collide by construction, whatever subset is present.
         *
         * The whole stack is absolutely positioned inside the fixed-aspect image, so it costs **no
         * card height**. That is the constraint that shaped this: an open house once had a text row
         * below the image, which was the only row those cards had and others did not, and it made
         * tiles in a grid different heights (#79a90aa).
         */}
        {(marketingBadge || openHouse) && (
          <div
            /*
             * `inset-x-3`, not `left-3` alone: the children cap themselves with percentage widths,
             * and a percentage against a shrink-to-fit parent is a cyclic dependency the browser
             * resolves by collapsing it — measured, the "Featured" pill came out 28px wide and
             * truncated to nothing. Pinning both edges gives this box a definite width (the image
             * less its two gutters) for those percentages to resolve against. `items-start` keeps
             * each pill sized to its own content inside it.
             */
            className={`absolute inset-x-3 flex flex-col items-start gap-1 ${
              isSold ? 'top-9' : 'top-3'
            }`}
          >
            {marketingBadge && (
              <span
                // Only the top row shares the save control's band, so only it is capped short of
                // `right-3`. 2rem of this container is that control plus its gutter.
                className="max-w-[calc(100%-2rem)] truncate rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-ink shadow-card"
              >
                {marketingBadge}
              </span>
            )}

            {openHouse && (
              /*
               * One pill, carrying its own date: `Open (8/16)`.
               *
               * The date is the part that must survive. A corner badge saying "Open Sat" was tried
               * and does not say *which* Saturday, and for an open house being off by a week is a
               * wasted trip to a house — which is why this spent time as a two-line band and then
               * as a pill with a second row under it. Both were the full string looking for room.
               *
               * **The content gives, not the type size.** This was briefly 8px, on the reasoning
               * that the string had to fit — and it was unreadable. It also does not generalise:
               * measured across the search grid, this badge has 133px of room at a 1536px viewport
               * but only 83px at 768px, where the card is 139px wide, and the full string needs
               * 173px at 11px. There is no font size that fits every card and stays legible.
               *
               * So the type stays at the card's own 11px and the *content* adapts to the card: the
               * schedule below a measured threshold, the date always. Which one renders is a
               * container query rather than a `md:` breakpoint, because the card's width does not
               * follow the viewport's — see the note on `.listing-card-media` in `globals.css`.
               *
               * `truncate` stays as a backstop rather than as the mechanism: neither form reaches
               * it, but without it a pathological string would spill across the save control.
               *
               * Brand fill, deliberately not the marketing pill's white. An open house is
               * time-bound in a way nothing else on the card is — it is the only badge that expires
               * — so the fill separates it at a glance from "Featured", which is a standing
               * property of the listing. `bg-brand` with `text-white` is the pairing used for
               * brand-filled controls throughout the app.
               */
              <span className="max-w-[calc(100%-2rem)] truncate rounded-full bg-brand px-2 py-1 text-[11px] font-medium text-white shadow-card">
                {/*
                 * Only the word is bold, so this reads as a label and its value rather than as one
                 * undifferentiated string — at 11px on a colour fill, a uniform weight makes
                 * "Open Sat 11am" scan as a single run of text.
                 *
                 * Both forms are rendered and the container query shows exactly one. `display: none`
                 * rather than visual hiding, so a screen reader is never handed the date twice.
                 */}
                <span className="font-bold">Open:</span>{' '}
                <span className="open-house-full">{formatOpenHouseBadge(openHouse)}</span>
                <span className="open-house-compact">{formatOpenHouseDate(openHouse)}</span>
              </span>
            )}
          </div>
        )}

        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleSave(listing.id);
          }}
          className={`absolute right-3 transition hover:scale-110 ${isSold ? 'top-9' : 'top-3'}`}
          aria-label={saved ? 'Unsave' : 'Save'}
        >
          <svg
            className={`h-5 w-5 drop-shadow ${saved ? 'fill-brand stroke-white' : 'fill-black/40 stroke-white'}`}
            viewBox="0 0 24 24"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
            />
          </svg>
        </button>
      </div>

      {/*
       * Info block with **reserved slots**, so every tile in a grid is the same height regardless of
       * which optional rows a row happens to have. Each variable row keeps its box whether or not it
       * has content:
       *
       * - the label row (sample / sponsored) — `h-5`, always present
       * - the stats line (absent for a parcel with unknown lot size, or an all-null dwelling) —
       *   `h-[18px]`, which is `caption-sm`'s line box; a slot sized for the old 12px text would
       *   clip the 13px it now holds
       * - attribution, which is one line for `internal`/`other` rows (see `ListingAttribution`)
       *
       * The open-house date row is gone entirely — it moved onto the image badge, and it was the
       * row that only some cards had. Attribution height still varies between an IDX row and one of
       * ours, which is uniform within any single-source result set; today every row is `internal`.
       */}
      <div className="pt-2">
        {/*
         * Required labels get a guaranteed slot that is reserved even when empty. They are never
         * what gets truncated or crowded out to make heights match — that is why they sit outside
         * the image's single badge slot in the first place. If the row is visible, these are visible.
         */}
        <div className="mb-1 flex h-5 flex-wrap items-center gap-1 overflow-hidden">
          {listing.isSample && <SampleBadge />}
          {listing.sponsored && <SponsoredBadge />}
        </div>

        {/* `caption` (14px/500). Was 14/600, a pairing the scale does not define. */}
        <h3 className="truncate text-sm font-medium text-ink">
          {formatListingLocation(listing.neighborhood, listing.city, listing.state)}
        </h3>

        {/* Reserved whether or not there are stats to show, so the price never shifts up a row. */}
        <p className="h-[18px] truncate text-[13px] leading-[18px] text-ink-muted">
          {statsLine ?? ' '}
        </p>

        {/* `title-md` (16px/600) on the figure, `body-md` (16/400) on the qualifiers. Was 14/600,
            which the scale does not pair — and it left the price no louder than the title. */}
        <p className="mt-0.5 truncate text-base text-ink">
          {soldLine ? (
            <span className="font-semibold">{soldLine}</span>
          ) : (
            <>
              <span className={price.isWithheld ? 'text-ink-body' : 'font-semibold'}>
                {price.text.split('/')[0]}
              </span>
              {!price.isWithheld && listing.listingType === 'rent' && (
                <span className="text-ink-muted"> /month</span>
              )}
            </>
          )}
        </p>

        {/*
         * Density follows the row's `source`. NAR 7.58 governs IDX displays — other participants'
         * listings from an MLS feed — so a `brightMLS` row gets the full block (agent name, a contact
         * method, the office name, at the 14px median floor) on search results as well as detail,
         * while our own inventory carries the office attribution PRD §6.2 requires. #33 turns the
         * full block on as data rather than as a card rewrite.
         */}
        <ListingAttribution
          attribution={listing}
          source={listing.source}
          className="mt-1 rounded-sm bg-surface-alt px-1.5 py-1"
        />
      </div>
    </div>
  );
}
