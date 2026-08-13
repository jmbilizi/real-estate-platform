'use client';

import { usePathname, useRouter } from 'next/navigation';
import type { ListingCardRow } from '@/lib/types';
import { useApp } from '@/lib/context';
import {
  formatClosePrice,
  formatDwellingStats,
  formatListingLocation,
  formatListingPrice,
  formatLotSize,
  formatOpenHouse,
  formatOpenHouseBadge,
} from '@/lib/listing-format';
import ListingAttribution from '@/components/listing/ListingAttribution';
import ListingImage from '@/components/listing/ListingImage';
import { SampleBadge, SponsoredBadge } from '@/components/listing/ListingBadges';

export default function ListingCard({ listing }: { listing: ListingCardRow }) {
  const { toggleSave, isSaved } = useApp();
  const saved = isSaved(listing.id);
  const router = useRouter();
  const pathname = usePathname();

  const openModal = () => {
    const params = new URLSearchParams(window.location.search);
    params.set('listing', listing.id);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  };

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
   * One badge slot on the image, filled by priority.
   *
   * Open house is consolidated here and carries the *when* ("Open Sat 1–3 PM"), replacing what used
   * to be three separate affordances on one card: this badge, a star chip beside the title, and a
   * full date/time text row. That text row was also the only row open-house cards had and other
   * cards did not, which is what made tiles in a grid different heights.
   *
   * Priority is deliberate rather than incidental:
   * - Open house outranks the rest because it is time-bound and actionable — it expires, the others
   *   do not.
   * - A **sold** row never shows an open-house badge. The API only sends upcoming occurrences, but
   *   a sold listing with one would be actively misleading, so the sold ribbon wins outright.
   * - The required disclosure labels (sample, sponsored) are NOT in this rotation and never compete
   *   for this slot — they have their own guaranteed row below the image. A marketing badge must
   *   never be able to displace a label that has to be shown.
   */
  const openHouseBadge = !isSold && listing.openHouse ? listing.openHouse : null;
  const marketingBadge = openHouseBadge
    ? formatOpenHouseBadge(openHouseBadge)
    : listing.priceReduced
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
            // Width is capped so the badge can never run under the save control at `right-3`;
            // 3.5rem is that control plus its gutter. Beyond that it truncates, and the `title` and
            // screen-reader text below keep the full range reachable.
            className={`absolute left-3 max-w-[calc(100%-3.5rem)] truncate rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-ink shadow-card ${
              isSold ? 'top-9' : 'top-3'
            }`}
            // The badge abbreviates the time, so the full range stays reachable.
            title={openHouseBadge ? `Open house ${formatOpenHouse(openHouseBadge)}` : undefined}
          >
            {marketingBadge}
            {openHouseBadge && (
              <span className="sr-only"> — open house {formatOpenHouse(openHouseBadge)}</span>
            )}
          </span>
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
       * - the stats line (absent for a parcel with unknown lot size, or an all-null dwelling) — `h-4`
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

        <h3 className="truncate text-sm font-semibold text-ink">
          {formatListingLocation(listing.neighborhood, listing.city, listing.state)}
        </h3>

        {/* Reserved whether or not there are stats to show, so the price never shifts up a row. */}
        <p className="h-4 truncate text-xs text-ink-muted">{statsLine ?? ' '}</p>

        <p className="mt-0.5 truncate text-sm text-ink">
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
