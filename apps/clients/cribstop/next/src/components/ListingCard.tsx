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

  // Marketing badges rotate through a single slot. The required disclosure labels (sample,
  // sponsored) are deliberately NOT in this rotation — a marketing badge must never be able to
  // win the slot from a label that has to be shown.
  const marketingBadge = listing.openHouse
    ? 'Open house'
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
            className={`absolute left-3 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-ink shadow-card ${
              isSold ? 'top-9' : 'top-3'
            }`}
          >
            {marketingBadge}
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

      {/* Info */}
      <div className="pt-2">
        {/*
         * Required labels, in their own row so they cannot be crowded out by a filter, a sort or a
         * viewport. If the row is visible, these are visible.
         */}
        {(listing.isSample || listing.sponsored) && (
          <div className="mb-1 flex flex-wrap items-center gap-1">
            {listing.isSample && <SampleBadge />}
            {listing.sponsored && <SponsoredBadge />}
          </div>
        )}

        <div className="flex items-start justify-between gap-1.5">
          <h3 className="truncate text-sm font-semibold text-ink">
            {formatListingLocation(listing.neighborhood, listing.city, listing.state)}
          </h3>
          {listing.openHouse && (
            <span className="flex flex-shrink-0 items-center gap-1 text-[11px] text-ink-muted">
              <svg className="h-2.5 w-2.5 fill-ink" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
              </svg>
              Open
            </span>
          )}
        </div>

        {/*
         * The date/time of the occurrence the API sent. "Upcoming" is never re-derived
         * client-side — the API populates `openHouse` only from an occurrence that has not ended,
         * so an open house it did not send is never displayed. The badge above already carries the
         * words "Open house", so this line is just the when.
         */}
        {listing.openHouse && (
          <p className="truncate text-xs text-ink-body">{formatOpenHouse(listing.openHouse)}</p>
        )}

        {statsLine && <p className="truncate text-xs text-ink-muted">{statsLine}</p>}

        <p className="mt-0.5 text-sm text-ink">
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
         * NAR 7.58 applies to search results, not only detail pages: the listing agent's name, at
         * least one contact method, and the office name, at or above the median type size used for
         * the listing data on this card.
         */}
        <ListingAttribution
          attribution={listing}
          className="mt-1 rounded-sm bg-surface-alt px-1.5 py-1"
        />
      </div>
    </div>
  );
}
