'use client';

import { useRouter } from 'next/navigation';
import type { ListingCardRow } from '@/lib/types';
import { useApp } from '@/lib/context';
import {
  formatClosePrice,
  formatDwellingStats,
  formatListingLocation,
  formatListingPrice,
  formatLotSize,
  formatOpenHouseWhen,
} from '@/lib/listing-format';
import ListingAttribution from '@/components/listing/ListingAttribution';
import ListingImage from '@/components/listing/ListingImage';
import { SampleBadge, SponsoredBadge } from '@/components/listing/ListingBadges';

export default function ListingCard({ listing }: { listing: ListingCardRow }) {
  const { toggleSave, isSaved } = useApp();
  const saved = isSaved(listing.id);
  const router = useRouter();

  /**
   * Navigates to the listing's own URL, which `@modal/(.)listing/[id]` intercepts and renders as a
   * modal over whatever page you are on.
   *
   * This used to push `?listing=<id>` onto the current route. That made the modal a *client-only*
   * thing — it was rendered by a listener in the root layout reading `useSearchParams()` — so on a
   * reload it could not exist until hydration, which is necessarily after the background page had
   * shipped and started fetching its own data. A real route renders on the server, so a reload of
   * this URL renders the listing and nothing else.
   */
  const openModal = () => router.push(`/listing/${listing.id}`, { scroll: false });

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
   * Open house gets its own full-width band across the foot of the image, not the corner pill.
   *
   * A card once carried three separate open-house affordances (a corner badge, a star chip beside
   * the title, and a full date/time text row). The text row was the only row open-house cards had
   * and other cards did not, which is what made tiles in a grid different heights — so it had to
   * go. Collapsing everything into the corner pill fixed the height but cost the date, and "Open
   * Sat" does not say *which* Saturday. An open house is the one listing fact where being off by a
   * week means a wasted trip to a house, so the whole statement has to be legible.
   *
   * The band solves both: it spans the card and stacks the label over the when, so the calendar
   * date survives instead of being truncated away, and it sits inside the fixed-aspect image, so it
   * costs no card height at all.
   *
   * A **sold** row never shows one. The API only sends upcoming occurrences, but a sold listing
   * with one would be actively misleading, so the sold ribbon wins outright.
   */
  const openHouse = !isSold && listing.openHouse ? listing.openHouse : null;

  /**
   * The corner pill is now purely marketing, and no longer contends with open house — moving open
   * house out is what freed it. The required disclosure labels (sample, sponsored) were never in
   * this rotation and still are not: they have their own guaranteed row below the image, because a
   * marketing badge must never be able to displace a label that has to be shown.
   */
  const marketingBadge = listing.priceReduced
    ? 'Price reduced'
    : listing.newConstruction
      ? 'New construction'
      : listing.featured
        ? 'Featured'
        : null;

  return (
    <div className="group block cursor-pointer" onClick={openModal}>
      {/* Image */}
      <div className="relative aspect-square overflow-hidden rounded-md bg-surface-soft">
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

        {marketingBadge && (
          <span
            // Width is capped so the pill can never run under the save control at `right-3`;
            // 3.5rem is that control plus its gutter.
            className={`absolute left-3 max-w-[calc(100%-3.5rem)] truncate rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-ink shadow-card ${
              isSold ? 'top-9' : 'top-3'
            }`}
          >
            {marketingBadge}
          </span>
        )}

        {/*
         * Two lines, because one does not fit: a grid card is ~181px wide and the label plus the
         * when need ~187px on a single 11px line. Stacking them is what lets the calendar date
         * survive instead of being truncated away.
         *
         * The scrim is what makes this legible over an arbitrary photo — white text on an unknown
         * image is a coin flip otherwise. It fades rather than sitting as a hard bar so it reads
         * as part of the image, and `pt-6` gives the gradient room to do that.
         */}
        {openHouse && (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/90 via-ink/70 to-transparent px-3 pb-2 pt-6">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-white/85">
              Open house
            </p>
            <p className="truncate text-[11px] font-semibold text-white">
              {formatOpenHouseWhen(openHouse)}
            </p>
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
