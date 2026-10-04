'use client';

import { useEffect, useState } from 'react';
import PropertyGallery from '@/components/PropertyGallery';
import AmenityChips from '@/components/AmenityChips';
import MortgageTeaser from '@/components/MortgageTeaser';
import ListingRow from '@/components/ListingRow';
import SingleListingMap from '@/components/SingleListingMap';
import ListingAttribution from '@/components/listing/ListingAttribution';
import GalleryStatusBadge from '@/components/listing/GalleryStatusBadge';
import ListingProvenance from '@/components/listing/ListingProvenance';
import ListingFacts from '@/components/listing/ListingFacts';
import { SampleBadge, SponsoredBadge } from '@/components/listing/ListingBadges';
import { NearbyHomesSkeleton } from '@/components/listing/ListingStates';
import { formatNumber, formatPrice } from '@/lib/format';
import {
  formatClosePrice,
  formatListingLocation,
  formatListingPrice,
  formatLotSize,
  formatOpenHouse,
  formatStreetAddress,
} from '@/lib/listing-format';
import { copyToClipboard } from '@/lib/clipboard';
import { buildListingShare, listingShareUrl } from '@/lib/listing-share';
import { searchListings } from '@/lib/api/listings';
import type { ListingDetailView } from '@/lib/api/listings';
import { useApp } from '@/lib/context';
import { useToast } from '@/lib/useToast';
import { searchTargetUrl } from '@/lib/search-place';
import type { ListingCardRow } from '@/lib/types';

interface Props {
  listing: ListingDetailView;
  /** Called when the back button is pressed */
  onClose?: () => void;
  /** #349: the property page passes its market status ('Under Contract' has no consumer status). */
  statusLabel?: string;
  /**
   * #382: the property page passes the service's nearby listings. They replace the client-side
   * "Nearby homes" fetch, so the page renders only what the page API returned.
   */
  nearby?: ListingCardRow[];
  /** #382: property page panels (the listing history), rendered before the nearby row. */
  propertyPanel?: React.ReactNode;
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

/** "Nearby homes" fetch lifecycle. A failed nice-to-have must not break the page, so a failure
 *  renders the same as "no results" — nothing — rather than an error banner. */
type NearbyState =
  | { status: 'loading'; results: [] }
  | { status: 'ready' | 'error'; results: ListingCardRow[] };

/** Half the side of the nearby search square, in degrees. Matches the property page API (~2 km). */
const NEARBY_HALF_SIDE = 0.02;

export default function ListingDetailContent({
  listing,
  onClose,
  statusLabel,
  nearby,
  propertyPanel,
}: Props) {
  const { toggleSave, isSaved } = useApp();
  const { toast } = useToast();
  const saved = isSaved(listing.id);

  /**
   * Share the listing.
   *
   * The Web Share API is the useful path on a phone, which is where a listing actually gets sent to
   * a partner or a parent. Everywhere else the link goes to the clipboard, with a toast, because a
   * silent copy reads the same as the inert button this replaces.
   *
   * The text comes from `lib/listing-share`, which holds the suppression and provenance rules, and
   * the clipboard carries the URL alone — the preview a recipient sees is then the route's own
   * Open Graph tags, which are built from the same module.
   */
  async function handleShare() {
    const url = listingShareUrl(listing.propertyPath, window.location.origin);

    if (typeof navigator.share === 'function') {
      try {
        await navigator.share(buildListingShare(listing, url));
        return;
      } catch (err) {
        /*
         * A dismissed share sheet is a choice, not a failure — copying behind the user's back
         * would undo it. Any other rejection falls through to the clipboard.
         *
         * The name alone decides it. An `instanceof DOMException` guard also holds in a browser,
         * but a WebView can reject with a plain `Error` named `AbortError`, and there the guard
         * would read a deliberate cancel as a failure and copy anyway.
         */
        if ((err as { name?: string } | null)?.name === 'AbortError') return;
      }
    }

    if (await copyToClipboard(url)) toast('Link copied');
    else toast('We could not copy the link.', 'error');
  }

  const [fetched, setFetched] = useState<NearbyState>({ status: 'loading', results: [] });

  const serverNearby = nearby !== undefined;

  useEffect(() => {
    if (serverNearby) return;
    const controller = new AbortController();
    setFetched({ status: 'loading', results: [] });

    /**
     * Same query as the property page API: active homes of the same offer (sale or rent) in a
     * square around this one, else in its city. A sold listing compares against live inventory.
     */
    const { latitude: lat, longitude: lng } = listing;
    const d = NEARBY_HALF_SIDE;
    const place =
      lat !== null && lng !== null
        ? {
            boundary: JSON.stringify({
              type: 'Polygon',
              coordinates: [
                [
                  [lng - d, lat - d],
                  [lng + d, lat - d],
                  [lng + d, lat + d],
                  [lng - d, lat + d],
                  [lng - d, lat - d],
                ],
              ],
            }),
          }
        : { city: listing.city, state: listing.state };
    searchListings(
      {
        ...place,
        listingType: listing.listingType === 'rent' ? 'rent' : 'sale',
        status: ['Active'],
        sort: 'newest',
        pageSize: 9,
      },
      controller.signal,
    )
      .then((envelope) => {
        setFetched({
          status: 'ready',
          results: envelope.results.filter((row) => row.id !== listing.id),
        });
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setFetched({ status: 'error', results: [] });
      });

    return () => controller.abort();
  }, [
    serverNearby,
    listing.id,
    listing.latitude,
    listing.longitude,
    listing.city,
    listing.state,
    listing.listingType,
  ]);

  const nearbyRows = serverNearby ? nearby : fetched.results;

  const nearbyHref = searchTargetUrl(
    { kind: 'place', place: { kind: 'city', city: listing.city, state: listing.state } },
    listing.listingType === 'rent' ? 'rent' : 'sale',
  );

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

  const lotSizeText = formatLotSize(listing.lotSqft);
  const priceDisplay = formatListingPrice(listing.price, listing.listingType);
  const closePriceText = formatClosePrice(listing.closePrice, listing.closeDate);

  // Non-parcel dwelling stat tiles — each part is omitted rather than rendered as a dash or a
  // zero when the API sends null, and the whole block is suppressed for a parcel (rule #4).
  const statTiles = listing.isParcel
    ? lotSizeText
      ? [{ label: 'Lot Size', value: lotSizeText }]
      : []
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
        {/* Address and stats live in the overview block, once. This bar holds actions only. */}
        <div className="min-w-0 flex-1" />
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={handleShare}
            className="btn-secondary px-2.5 sm:gap-1.5 sm:px-5"
            aria-label="Share"
          >
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
          <PropertyGallery media={listing.media} tourUrl={listing.virtualTourUrl}>
            <GalleryStatusBadge {...listing} statusLabel={statusLabel} />
          </PropertyGallery>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_380px] lg:items-start">
          {/* Main column */}
          <div className="space-y-4">
            {/*
             * Overview (#568): the one place price, address and stats appear. The header bar, the
             * map section and the mobile bar carry none of them. The status badge is on the gallery
             * (#565). The stat tiles sit inside this panel under a hairline.
             */}
            <section id="overview" className={PANEL}>
              <div className="p-6">
                <div className="mb-3 flex flex-wrap items-center gap-1.5 empty:hidden">
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
                  <div className="rounded-2xl border border-surface-border bg-surface-alt px-4 py-3">
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
                   * `display-sm` (20px/600). It sits first in the panel under the gallery, which
                   * is placement enough, so it does not outrank the section headings.
                   */
                  <p
                    className={
                      priceDisplay.isWithheld
                        ? 'text-base font-medium italic text-ink-muted'
                        : 'text-xl font-semibold tracking-[-0.18px] text-ink'
                    }
                  >
                    {priceDisplay.text}
                  </p>
                )}

                {/*
                 * The street line already carries city, state and ZIP. When the seller withheld
                 * the address the heading is the location alone: `title` is never a fallback
                 * (#59), and there is no second line to repeat it.
                 */}
                <h1 className="mt-2 text-base font-semibold tracking-tight text-ink">
                  {streetAddress ?? suppressedAddressHeading}
                </h1>
              </div>

              {/* A parcel has no dwelling, so it shows lot size instead of the dwelling tiles. */}
              {statTiles.length > 0 && (
                <div className="grid grid-cols-2 gap-y-4 border-t border-surface-border px-6 py-4 sm:grid-cols-3 lg:grid-cols-6">
                  {statTiles.map((s) => (
                    <div key={s.label} className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
                        {s.label}
                      </p>
                      <p className="mt-1 break-words text-base font-semibold text-ink">{s.value}</p>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Description */}
            {listing.description && (
              <div className={`${PANEL} p-6`}>
                <h2 className="text-xl font-semibold tracking-tight">About this home</h2>
                <p className="mt-3 leading-relaxed text-ink-muted">{listing.description}</p>
              </div>
            )}

            <ListingFacts listing={listing} className={PANEL} />

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
            <section id="map" className={`${PANEL} p-6`}>
              <h2 className="text-xl font-semibold tracking-tight">Where you&apos;ll live</h2>
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
            </section>

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
                {/*
                 * #344: NAR 7.58 requires the firm plus a phone OR an email, not both. Bright
                 * omits the office email on 45% of the feed, so `brokerEmail` is nullable and
                 * `brokerPhone` can be `''` on the rare row with an email and no phone — each
                 * line renders only when its value is present.
                 */}
                {listing.brokerPhone && (
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
                )}
                {listing.brokerEmail && (
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
                )}
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

        {propertyPanel !== undefined && (
          <div id="history" className={`mt-4 ${PANEL}`}>
            {propertyPanel}
          </div>
        )}

        {/* Nearby homes — the last panel, so the stack closes the way it opened. */}
        {!serverNearby && fetched.status === 'loading' && (
          <div id="nearby" className={`mt-4 ${PANEL}`}>
            <NearbyHomesSkeleton />
          </div>
        )}
        {nearbyRows.length > 0 && (
          <div id="nearby" className={`mt-4 ${PANEL}`}>
            {/* The panel's own inset: `ListingRow` defaults to a full-bleed section's gutter. */}
            <ListingRow
              title="Nearby homes"
              listings={nearbyRows}
              max={6}
              href={nearbyHref}
              sectionClassName="px-6 py-6"
              titleClassName="text-xl font-semibold tracking-tight"
            />
          </div>
        )}
      </div>
      {/* end body wrapper */}

      {/* Mobile sticky CTA bar */}
      <div className="flex-shrink-0 border-t border-surface-border bg-white/95 shadow-[0_-4px_16px_rgba(0,0,0,0.08)] backdrop-blur-sm lg:hidden">
        {/* No price here: the overview block holds it once (#568). */}
        <div className="flex gap-2 px-4 py-3">
          <button className="btn-secondary flex-1 py-2 text-sm">Message</button>
          <button className="btn-primary flex-1 py-2 text-sm">Schedule Tour</button>
        </div>
      </div>
    </div>
  );
}
