'use client';

import { useEffect, useState } from 'react';
import PropertyGallery from '@/components/PropertyGallery';
import AmenityChips from '@/components/AmenityChips';
import MortgageTeaser from '@/components/MortgageTeaser';
import ListingRow from '@/components/ListingRow';
import SingleListingMap from '@/components/SingleListingMap';
import ListingAttribution from '@/components/listing/ListingAttribution';
import ListingProvenance from '@/components/listing/ListingProvenance';
import { SampleBadge, SponsoredBadge } from '@/components/listing/ListingBadges';
import { SimilarHomesSkeleton } from '@/components/listing/ListingStates';
import { formatNumber, formatPrice } from '@/lib/format';
import {
  formatClosePrice,
  formatDwellingStats,
  formatListingLocation,
  formatListingPrice,
  formatLotSize,
  formatOpenHouse,
  formatStreetAddress,
} from '@/lib/listing-format';
import { searchListings } from '@/lib/api/listings';
import type { ListingDetailView } from '@/lib/api/listings';
import { useApp } from '@/lib/context';
import type { ListingCardRow } from '@/lib/types';

interface Props {
  listing: ListingDetailView;
  /** Called when the back button is pressed */
  onClose?: () => void;
}

/**
 * One panel primitive, used by every section on this page.
 *
 * The loading skeleton makes a promise the loaded page used to break: in the skeleton every block
 * is the same object — a rounded, bordered panel with a consistent gutter — so the page reads as a
 * calm stack of equal-weight cards. The loaded page then rendered *some* sections as panels (stats,
 * map, disclosure, agent, open houses) and others as bare text floating on the canvas (price,
 * description, amenities), so the layout appeared to come apart at the exact moment the data
 * arrived.
 *
 * Both halves of the fix matter. Applying one primitive everywhere is the obvious half; the other
 * is the canvas. These panels were already white on a white page, where a hairline border does
 * almost no work — the body is `surface-alt` now, which is what lets a panel actually read as one.
 *
 * Values are the existing system's (`rounded-2xl`, `surface-border`, `surface-alt`), not new ones:
 * the brief is to make what we already have consistent, not to introduce another visual language.
 */
const PANEL = 'rounded-2xl border border-surface-border bg-white';

/** "Similar Homes" fetch lifecycle. A failed nice-to-have must not break the page, so a failure
 *  renders the same as "no results" — nothing — rather than an error banner. */
type SimilarState =
  | { status: 'loading'; results: [] }
  | { status: 'ready' | 'error'; results: ListingCardRow[] };

export default function ListingDetailContent({ listing, onClose }: Props) {
  const { toggleSave, isSaved } = useApp();
  const saved = isSaved(listing.id);

  const [similar, setSimilar] = useState<SimilarState>({ status: 'loading', results: [] });

  useEffect(() => {
    const controller = new AbortController();
    setSimilar({ status: 'loading', results: [] });

    /**
     * `listingType` matters as much as `propertyType` here: without it, a $1.9M condo for sale was
     * shown rentals as "similar homes", and the "See all" link — which does carry the listing type
     * — went somewhere that did not match what the row above it showed.
     *
     * A sold listing is deliberately compared against sold inventory rather than live: the useful
     * comparison for a closed sale is other closed sales, and `listingType=all` excludes sold
     * anyway, so asking for it explicitly is the only way to get any results at all.
     */
    searchListings(
      {
        propertyType: listing.propertyType,
        listingType: listing.listingType,
        pageSize: 8,
      },
      controller.signal,
    )
      .then((envelope) => {
        setSimilar({
          status: 'ready',
          results: envelope.results.filter((row) => row.id !== listing.id),
        });
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setSimilar({ status: 'error', results: [] });
      });

    return () => controller.abort();
  }, [listing.id, listing.propertyType, listing.listingType]);

  const similarHref = `/search?type=${listing.listingType}&q=${encodeURIComponent(`${listing.propertyType} ${listing.city}`)}`;

  const streetAddress = formatStreetAddress(
    listing.address,
    listing.city,
    listing.state,
    listing.zip,
  );
  /**
   * The heading for a listing whose seller opted out of address display.
   *
   * It must NOT fall back to `listing.title`. Address suppression currently masks `address`,
   * `latitude` and `longitude` (and `unit.unitNumber`), but **not** the free-text `title`, which is
   * an open server-side gap tracked as #59 — sample titles like "Alexandria Waterfront Penthouse"
   * are harmless, but a real feed's title routinely contains the street line. Rendering it here
   * would hand back exactly the address the seller withheld, which is the whole point of the
   * suppression. Location has no street component by construction, so it is safe whatever #59 does.
   */
  const suppressedAddressHeading = formatListingLocation(
    listing.neighborhood,
    listing.city,
    listing.state,
  );

  const dwellingStats = formatDwellingStats(listing.beds, listing.baths, listing.sqft);
  const lotSizeText = formatLotSize(listing.lotSqft);
  const priceDisplay = formatListingPrice(listing.price, listing.listingType);
  const closePriceText = formatClosePrice(listing.closePrice, listing.closeDate);

  // Non-parcel dwelling stat tiles — each part is omitted rather than rendered as a dash or a
  // zero when the API sends null, and the whole block is suppressed for a parcel (rule #4).
  const statTiles = listing.isParcel
    ? []
    : [
        ...(listing.beds !== null ? [{ label: 'Beds', value: listing.beds }] : []),
        ...(listing.baths !== null ? [{ label: 'Baths', value: listing.baths }] : []),
        ...(listing.sqft !== null ? [{ label: 'Sqft', value: formatNumber(listing.sqft) }] : []),
        { label: 'Type', value: listing.propertyType },
        ...(listing.yearBuilt !== null ? [{ label: 'Year Built', value: listing.yearBuilt }] : []),
        ...(listing.lotSqft !== null
          ? [{ label: 'Lot Size', value: `${formatNumber(listing.lotSqft)} sf` }]
          : []),
      ];

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Airbnb-style: address + key stats left · Share/Save right — above gallery */}
      <div className="flex-shrink-0 flex items-center gap-3 border-b border-surface-border px-6 sm:px-8 pt-4 pb-3 bg-white">
        {onClose && (
          <button
            onClick={onClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-surface-border bg-white hover:bg-surface-soft transition-colors"
            aria-label="Go back"
          >
            <svg
              className="h-5 w-5 text-ink"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={2.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}
        <div className="min-w-0 flex-1">
          {/*
           * `title-md` (16px/600) flat, replacing a `text-xs`→`text-xl` ladder that rendered this
           * heading at 12/14/16/18/20px depending on viewport — four of those five are not steps
           * in the DESIGN.md scale. If this changes, the skeleton's placeholder in
           * `ListingStates` must change with it or the two states stop measuring the same.
           */}
          <h1 className="text-base font-semibold tracking-tight text-ink">
            {streetAddress ?? suppressedAddressHeading}
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            {[dwellingStats, listing.propertyType].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button className="btn-secondary px-2.5 sm:gap-1.5 sm:px-5" aria-label="Share">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
              />
            </svg>
            <span className="hidden sm:inline">Share</span>
          </button>
          <button
            onClick={() => toggleSave(listing.id)}
            className={`btn-secondary px-2.5 sm:gap-1.5 sm:px-5 ${saved ? 'border-brand text-brand' : ''}`}
            aria-label={saved ? 'Saved' : 'Save'}
          >
            <svg
              className={`h-4 w-4 ${saved ? 'fill-brand' : 'fill-none'}`}
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
              />
            </svg>
            <span className="hidden sm:inline">{saved ? 'Saved' : 'Save'}</span>
          </button>
        </div>
      </div>

      {/* Scrollable body — `surface-alt` is the canvas that makes a white panel read as a panel. */}
      <div className="flex-1 min-h-0 scrollbar-overlay bg-surface-alt px-6 sm:px-8 py-4 pb-8">
        {/* Gallery — the first panel, exactly the block the skeleton opens with. */}
        <div className={`overflow-hidden ${PANEL}`}>
          <PropertyGallery media={listing.media} />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_380px] lg:items-start">
          {/* Main column */}
          <div className="space-y-4">
            {/* Badges + price + address */}
            <div className={`${PANEL} p-6`}>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="badge bg-surface-border text-ink">{listing.status}</span>
                {listing.isSample && <SampleBadge />}
                {listing.sponsored && <SponsoredBadge />}
                {listing.priceReduced && (
                  <span className="badge bg-amber-100 text-amber-800">Price Reduced</span>
                )}
                {listing.newConstruction && (
                  <span className="badge bg-emerald-100 text-emerald-800">New Construction</span>
                )}
              </div>

              {closePriceText ? (
                <div className="mt-3 rounded-2xl border border-surface-border bg-surface-alt px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
                    Sold
                  </p>
                  <p className="mt-1 text-xl font-semibold tracking-[-0.18px] text-ink">
                    {closePriceText}
                  </p>
                  {listing.price !== null && (
                    <p className="mt-1 text-sm text-ink-muted">
                      Listed at {formatPrice(listing.price, listing.listingType)}
                    </p>
                  )}
                </div>
              ) : (
                /*
                 * `display-sm` (20px/600) — the same style as the monthly estimate, deliberately.
                 *
                 * It has been 36px/800, then 30px/700, then 21px/700. Each step was still asking
                 * the price to dominate the page. It does not need to: it sits alone in a panel
                 * directly under the gallery, which is placement enough, and the surrounding
                 * section headings are the same size. Matching the estimate's weight rather than
                 * outranking it takes the last of the shout out of it.
                 */
                <p
                  className={
                    priceDisplay.isWithheld
                      ? 'mt-3 text-base font-medium italic text-ink-muted'
                      : 'mt-3 text-xl font-semibold tracking-[-0.18px] text-ink'
                  }
                >
                  {priceDisplay.text}
                </p>
              )}

              <p className="mt-2 text-ink-muted">
                {formatListingLocation(listing.neighborhood, listing.city, listing.state)}{' '}
                {listing.zip}
              </p>
            </div>

            {/* Stats — suppressed entirely for a parcel, which shows lot size instead */}
            {listing.isParcel
              ? lotSizeText && (
                  <div className={`max-w-xs ${PANEL} px-5 py-4`}>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
                      Lot Size
                    </p>
                    <p className="mt-1 text-base font-semibold text-ink">{lotSizeText}</p>
                  </div>
                )
              : statTiles.length > 0 && (
                  <div
                    className={`grid grid-cols-2 gap-0 overflow-hidden ${PANEL} sm:grid-cols-3 lg:grid-cols-6`}
                  >
                    {statTiles.map((s, i, arr) => (
                      <div
                        key={s.label}
                        className={`px-5 py-4 ${i !== arr.length - 1 ? 'border-b border-surface-border sm:border-b-0 sm:border-r' : ''}`}
                      >
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
                          {s.label}
                        </p>
                        <p className="mt-1 text-base font-semibold text-ink">{s.value}</p>
                      </div>
                    ))}
                  </div>
                )}

            {/* Description */}
            {listing.description && (
              <div className={`${PANEL} p-6`}>
                <h2 className="text-xl font-semibold tracking-tight">About this home</h2>
                <p className="mt-3 leading-relaxed text-ink-muted">{listing.description}</p>
              </div>
            )}

            {/* Amenities */}
            {listing.amenities.length > 0 && (
              <div className={`${PANEL} p-6`}>
                <h2 className="text-xl font-semibold tracking-tight">Features &amp; amenities</h2>
                <div className="mt-4">
                  <AmenityChips amenities={listing.amenities} />
                </div>
              </div>
            )}

            {/* Where you'll live */}
            <div className={`${PANEL} p-6`}>
              <h2 className="text-xl font-semibold tracking-tight">Where you&apos;ll live</h2>
              <p className="mt-2 text-sm text-ink-muted">
                {formatListingLocation(listing.neighborhood, listing.city, listing.state)}
              </p>
              {/* Square, not rounded: the panel around it is already a rounded card, and a second
                  radius inside the first reads as a card within a card. Keeping the hairline gives
                  the map an edge without repeating the container's shape. */}
              <div className="mt-4 overflow-hidden border border-surface-border">
                <SingleListingMap
                  latitude={listing.latitude}
                  longitude={listing.longitude}
                  price={listing.price}
                  listingType={listing.listingType}
                  className="h-[380px] w-full"
                />
              </div>
            </div>

            {/* Listing disclosure — provenance is driven off this row's own `source`, never a
                build flag, env var or default (rule #6). */}
            <div className={`${PANEL} p-6 text-[13px] leading-relaxed text-ink-muted`}>
              {/*
               * `courtesy`, not `full`: the Listing Agent card alongside this already carries the
               * agent's name, office, phone and email, so the full block repeated all of it a few
               * hundred pixels away. 7.58 asks that the display identify the listing firm and a
               * participant-supplied contact method — the agent card does that, more prominently
               * than a footnote can. This block is the courtesy attribution and the provenance.
               */}
              <ListingAttribution
                attribution={listing}
                source={listing.source}
                density="courtesy"
                className="text-ink-body"
              />
              <ListingProvenance
                source={listing.source}
                lastUpdated={listing.lastUpdated}
                className="mt-2"
              />
              <p className="mt-2">
                This information is for personal, non-commercial use. Some properties may no longer
                be available.
              </p>
            </div>
          </div>

          {/* Sidebar */}
          <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
            {/*
             * Flat, like every other panel. This carried `shadow-card` as the page's single point
             * of elevation, but the shadow darkens the card's own edges enough that it reads as a
             * slightly off-white surface beside its flat neighbours — the fill was always
             * identical `#ffffff`. Emphasis here comes from the primary button, not from the
             * container.
             */}
            <div className={`${PANEL} p-6`}>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
                Listing Agent
              </p>
              <div className="mt-3 flex items-center gap-3">
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand-700 font-bold text-white">
                  {listing.brokerName[0]}
                </div>
                <div className="min-w-0">
                  <p className="truncate font-semibold text-ink">
                    {listing.listingAgentName ?? listing.brokerName}
                  </p>
                  <p className="truncate text-[13px] text-ink-muted">{listing.officeName}</p>
                </div>
              </div>
              <div className="mt-4 space-y-1.5 text-sm">
                <p className="flex items-center gap-2 text-ink-muted">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                    />
                  </svg>
                  {listing.brokerPhone}
                </p>
                <p className="flex items-center gap-2 text-ink-muted">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                    />
                  </svg>
                  {listing.brokerEmail}
                </p>
                {listing.officeBrokerLeadPhone && (
                  <p className="flex items-center gap-2 text-ink-muted">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                      />
                    </svg>
                    <span className="text-ink-subtle">Office:</span>&nbsp;
                    {listing.officeBrokerLeadPhone}
                  </p>
                )}
                {listing.officeBrokerLeadEmail && (
                  <p className="flex items-center gap-2 text-ink-muted">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                      />
                    </svg>
                    <span className="text-ink-subtle">Office:</span>&nbsp;
                    {listing.officeBrokerLeadEmail}
                  </p>
                )}
              </div>
              <button className="btn-primary mt-5 w-full">Schedule a Tour</button>
              <button className="btn-secondary mt-2 w-full">Message Agent</button>
            </div>

            {/* Open houses — the API sends only upcoming occurrences, so "upcoming" is never
                re-derived here and an occurrence the API did not send is never displayed. */}
            {listing.openHouses.length > 0 && (
              <div className="rounded-2xl border border-brand/20 bg-brand-50 p-5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-700">
                  {listing.openHouses.length > 1 ? 'Upcoming Open Houses' : 'Upcoming Open House'}
                </p>
                <ul className="mt-2 space-y-3">
                  {listing.openHouses.map((openHouse, i) => (
                    <li key={i}>
                      <p className="text-base font-semibold text-ink">
                        {formatOpenHouse(openHouse)}
                      </p>
                      {openHouse.remarks && (
                        <p className="text-sm text-ink-muted">{openHouse.remarks}</p>
                      )}
                    </li>
                  ))}
                </ul>
                <button className="mt-3 text-sm font-semibold text-brand hover:underline">
                  + Add to calendar
                </button>
              </div>
            )}

            {/* Mortgage */}
            {listing.listingType === 'sale' && listing.price !== null && (
              <MortgageTeaser price={listing.price} />
            )}
          </aside>
        </div>

        {/* Similar homes — the last panel, so the stack closes the way it opened. */}
        {similar.status === 'loading' && (
          <div className={`mt-4 ${PANEL}`}>
            <SimilarHomesSkeleton />
          </div>
        )}
        {similar.status === 'ready' && similar.results.length > 0 && (
          <div className={`mt-4 ${PANEL}`}>
            {/* `ListingRow` defaults to the page-level gutter (`px-6 sm:px-10 lg:px-20`), which is
                a full-bleed section's padding, not a panel's — inside a panel it put the heading
                and cards hard against the border. This is the panel's own inset. */}
            <ListingRow
              title="Similar homes"
              listings={similar.results}
              max={6}
              href={similarHref}
              sectionClassName="px-6 py-6"
              /* Matches this page's other section headings exactly — see `titleClassName`. */
              titleClassName="text-xl font-semibold tracking-tight"
            />
          </div>
        )}
      </div>
      {/* end body wrapper */}

      {/* Mobile sticky CTA bar */}
      <div className="flex-shrink-0 border-t border-surface-border bg-white/95 shadow-[0_-4px_16px_rgba(0,0,0,0.08)] backdrop-blur-sm lg:hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            {/*
             * `priceDisplay.text` rather than a re-format through `formatPrice`, which took a
             * non-null `number` and so needed an `as number` cast here. The cast was unreachable
             * behind the ternary, but `formatPrice(null)` renders `$0` via `Intl.NumberFormat` —
             * exactly the fabricated price the withheld copy exists to prevent — so the cast was one
             * refactor away from being the bug. There is now no path that can format a null price.
             */}
            {/* `title-md` (16px/600). Was 18px/800 — the last `extrabold` on the page, and the
                system defines no 800 weight at any size. */}
            <p className="text-base font-semibold leading-tight text-ink">
              {closePriceText ?? priceDisplay.text.split('/')[0]}
            </p>
            {!priceDisplay.isWithheld && listing.listingType === 'rent' && (
              <p className="text-xs text-ink-muted">/month</p>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            <button className="btn-secondary py-2 text-sm">Message</button>
            <button className="btn-primary py-2 text-sm">Schedule Tour</button>
          </div>
        </div>
      </div>
    </div>
  );
}
