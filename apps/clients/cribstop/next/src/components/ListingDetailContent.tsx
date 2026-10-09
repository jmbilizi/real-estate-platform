'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import ToolbarIconButton, {
  BACK_ICON,
  HEART_ICON,
  SHARE_ICON,
} from '@/components/ToolbarIconButton';
import Link from 'next/link';
import type { InquiryKind } from '@cribstop/property-contracts';
import BuyerAgentRequestDialog from '@/components/listing/BuyerAgentRequestDialog';
import PropertyGallery from '@/components/PropertyGallery';
import AmenityChips from '@/components/AmenityChips';
import MortgageTeaser from '@/components/MortgageTeaser';
import ListingRow from '@/components/ListingRow';
import SingleListingMap from '@/components/SingleListingMap';
import GalleryStatusBadge from '@/components/listing/GalleryStatusBadge';
import ListingProvenance from '@/components/listing/ListingProvenance';
import ListingFacts from '@/components/listing/ListingFacts';
import PriceHistory from '@/components/listing/PriceHistory';
import ListingHeaderNav from '@/components/listing/ListingHeaderNav';
import { SampleBadge, SponsoredBadge } from '@/components/listing/ListingBadges';
import { NearbyHomesSkeleton } from '@/components/listing/ListingStates';
import { formatCalendarDate, formatNumber, formatPrice } from '@/lib/format';
import { describePriceChange, formatDetailPriceChange } from '@/lib/price-change';
import { BRAND } from '@/lib/brand';
import {
  agentContactLines,
  agentInitials,
  formatClosePrice,
  formatListingLocation,
  formatListingPrice,
  formatLotSize,
  formatOpenHouse,
  formatStreetAddress,
  officeInitial,
} from '@/lib/listing-format';
import { copyToClipboard } from '@/lib/clipboard';
import { buildListingShare, listingShareUrl } from '@/lib/listing-share';
import { shareOrigin } from '@/lib/site-origin';
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
const PHONE_ICON =
  'M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z';
const EMAIL_ICON =
  'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z';
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
  const saved = isSaved(listing.propertyId);
  const rootRef = useRef<HTMLDivElement>(null);
  // #132: one request path for every "Request a Tour" and "Message Agent" button.
  const [requestKind, setRequestKind] = useState<InquiryKind | null>(null);
  const closeRequest = useCallback(() => setRequestKind(null), []);
  // A closed sale cannot take a request. Field suppression never changes this.
  const canRequest = listing.status !== 'Sold';
  const onRequestTour = () => setRequestKind('tour_request');
  const onMessageAgent = () => setRequestKind('message');
  const headerRef = useRef<HTMLDivElement>(null);

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
    const url = listingShareUrl(listing.propertyPath, shareOrigin());

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
  const priceChange = describePriceChange(listing);

  // #716. The MLS day count when the feed carries it. Otherwise the oldest list date of the home.
  // Never a number we worked out ourselves.
  const marketTimeTile =
    listing.daysOnMarket !== null
      ? [{ label: 'Days on Market', value: formatNumber(listing.daysOnMarket) }]
      : listing.listedSince !== null
        ? [{ label: 'Listed since', value: formatCalendarDate(listing.listedSince) }]
        : [];

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
        ...marketTimeTile,
        ...(listing.lotSqft !== null
          ? [{ label: 'Lot Size', value: `${formatNumber(listing.lotSqft)} sf` }]
          : []),
      ];

  // Shared by the detail header and the full-screen photo viewer.
  const shareSaveButtons = (
    <>
      <ToolbarIconButton label="Share" icon={SHARE_ICON} onClick={handleShare} />
      <ToolbarIconButton
        label="Save"
        tooltip={saved ? 'Remove from saved' : 'Save'}
        icon={HEART_ICON}
        pressed={saved}
        onClick={() => toggleSave(listing)}
      />
    </>
  );

  return (
    <div ref={rootRef} className="flex flex-col h-full min-h-0">
      {/*
       * Detail header (#594): back, then price, address and section links on desktop, Share and
       * Save right. `.listing-header` pins it under the site header on the page and at the top of
       * the modal.
       */}
      <div
        ref={headerRef}
        className="listing-header flex-shrink-0 flex items-center gap-3 border-b border-surface-border px-6 sm:px-8 pt-4 pb-3 bg-white"
      >
        {onClose && <ToolbarIconButton label="Go back" icon={BACK_ICON} onClick={onClose} />}
        {/* The price and address repeat the overview. The stakeholder accepts this one exception. */}
        <ListingHeaderNav
          headerRef={headerRef}
          scopeRef={rootRef}
          price={closePriceText ?? priceDisplay.text}
          address={listing.address || suppressedAddressHeading}
          skip={nearbyRows.length > 0 ? [] : ['nearby']}
        />
        <div className="min-w-0 flex-1 md:hidden" />
        <div className="flex shrink-0 items-center gap-1.5">{shareSaveButtons}</div>
      </div>

      {/* Scrollable body — `surface-alt` is the canvas that makes a white panel read as a panel. */}
      <div
        data-scroll-body
        className="flex-1 min-h-0 scrollbar-overlay bg-surface-alt px-6 sm:px-8 py-4 pb-8"
      >
        {/* Gallery — the first panel, exactly the block the skeleton opens with. */}
        <div className={`overflow-hidden ${PANEL}`}>
          <PropertyGallery
            media={listing.media}
            tourUrl={listing.virtualTourUrl}
            viewerActions={shareSaveButtons}
          >
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
                  {listing.priceReduced && priceChange?.direction !== 'up' && (
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

                {/* #717. Two stored MLS prices. A cut and an increase read alike. */}
                {priceChange && !closePriceText && (
                  <p className="mt-1 text-sm text-ink-body" data-testid="price-change">
                    {formatDetailPriceChange(priceChange)}
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

                {/* #716. Each other live MLS record of this home opens at its own URL. */}
                {listing.alsoListedAs.length > 0 && (
                  <p className="mt-2 text-sm text-ink-muted">
                    Also listed as{' '}
                    {listing.alsoListedAs.map((other, index) => (
                      <span key={other.id}>
                        {index > 0 && ', '}
                        <Link
                          href={`/listing/${other.id}`}
                          className="font-medium text-brand underline"
                        >
                          {other.mlsNumber ? `MLS# ${other.mlsNumber}` : 'another MLS record'}
                        </Link>
                      </span>
                    ))}
                  </p>
                )}
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

            {/* #717 */}
            <PriceHistory entries={listing.priceHistory} className={PANEL} />

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
                  className="listing-detail-map h-[380px] w-full"
                />
              </div>
            </section>
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
                {listing.listingAgentName ? 'Listing Agent' : 'Listing Office'}
              </p>
              <div className="mt-3 flex items-center gap-3">
                {/* Monogram: the feed has no agent photo keyed to the listing agent (#564). */}
                <div
                  aria-hidden="true"
                  className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand-700 font-bold text-white"
                >
                  {listing.listingAgentName
                    ? agentInitials(listing.listingAgentName)
                    : officeInitial(listing.officeName)}
                </div>
                <div className="min-w-0">
                  <p className="truncate font-semibold text-ink">
                    {listing.listingAgentName ?? listing.officeName}
                  </p>
                  {listing.listingAgentName && (
                    <p className="truncate text-sm text-ink-muted">{listing.officeName}</p>
                  )}
                </div>
              </div>
              {/*
               * #344: NAR 7.58 requires the firm plus a phone OR an email, not both, so the office
               * lines stay beside the agent's own. Each line renders only when its value is
               * present, and each is one tap. `min-h-11` keeps the tap target 44px on a phone.
               */}
              <ul className="mt-4 space-y-1 text-sm">
                {agentContactLines(listing).map((line) => (
                  <li key={`${line.kind}:${line.value}`}>
                    <a
                      href={line.href}
                      className="flex min-h-11 items-center gap-2 break-all text-ink-muted hover:text-brand"
                    >
                      <svg
                        className="h-4 w-4 flex-shrink-0"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d={line.kind === 'phone' ? PHONE_ICON : EMAIL_ICON}
                        />
                      </svg>
                      <span className="text-ink-subtle">{line.owner}:</span>
                      <span>{line.value}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            {/*
             * #591: the buyer-agent request. These actions ask Cribstop (Real Broker, LLC) to act
             * as the consumer's own buyer agent. They never reach the listing agent, who is
             * contacted only through the call and email links above. A request is not a booking:
             * no copy may say a tour is booked, confirmed or scheduled.
             */}
            <div className={`${PANEL} p-6`} data-testid="buyer-agent-card">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
                Your Buyer Agent
              </p>
              <p className="mt-3 font-semibold text-ink">
                {BRAND.siteName}, brokered by <span className="font-bold">{BRAND.brokerage}</span>
              </p>
              <p className="mt-1 text-sm leading-snug text-ink-muted">
                Request a tour with a {BRAND.siteName} buyer agent. Touring with an agent may
                require a written buyer agreement. A tour request is not a booking.
              </p>
              {canRequest ? (
                <>
                  <button
                    type="button"
                    className="btn-primary mt-5 min-h-11 w-full"
                    onClick={onRequestTour}
                  >
                    Request a Tour
                  </button>
                  <button
                    type="button"
                    className="btn-secondary mt-2 min-h-11 w-full"
                    onClick={onMessageAgent}
                  >
                    Message Agent
                  </button>
                </>
              ) : (
                <p className="mt-4 text-sm font-medium text-ink">
                  This home is no longer available, so requests are closed.
                </p>
              )}
              <p className="mt-4 text-sm font-medium leading-snug text-ink-muted">
                Brokered by {BRAND.brokerage} &middot; {BRAND.siteName}
              </p>
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
                <button className="mt-1 min-h-11 text-sm font-semibold text-brand hover:underline">
                  + Add to calendar
                </button>
              </div>
            )}

            {/* Mortgage */}
            {listing.listingType === 'sale' && listing.price !== null && (
              <MortgageTeaser
                price={listing.price}
                taxAnnualAmount={listing.taxAnnualAmount}
                hoaFee={listing.hoaFee}
                hoaFeeFrequency={listing.hoaFeeFrequency}
              />
            )}
          </aside>
        </div>

        {propertyPanel !== undefined && (
          <div id="history" className={`mt-4 ${PANEL}`}>
            {propertyPanel}
          </div>
        )}

        {/* Nearby homes. A carousel, like the home page rows, so it has no panel around it. */}
        {!serverNearby && fetched.status === 'loading' && (
          <div id="nearby" className="mt-4">
            <NearbyHomesSkeleton />
          </div>
        )}
        {nearbyRows.length > 0 && (
          <div id="nearby" className="mt-4">
            {/* No side inset: the body's gutter already aligns the title with the panels above. */}
            <ListingRow
              title="Nearby homes"
              listings={nearbyRows}
              max={6}
              href={nearbyHref}
              sectionClassName="pt-2"
              titleClassName="text-xl font-semibold tracking-tight"
            />
          </div>
        )}

        {/*
         * The listing disclaimer: two centered lines under a hairline, at the very end. The attribution NAR 7.58
         * requires (firm, agent, a contact method) lives in the Listing Agent card, once.
         * Provenance is driven off this row's own `source`, never a build flag or default.
         */}
        <footer className="mt-8 space-y-1.5 border-t border-surface-border pt-6 text-center text-xs leading-relaxed text-ink-muted">
          <ListingProvenance source={listing.source} lastUpdated={listing.lastUpdated} />
          <p>
            This information is for personal, non-commercial use. Some properties may no longer be
            available.
          </p>
        </footer>
      </div>
      {/* end body wrapper */}

      {/*
       * Mobile CTA bar (#572). In the modal it is the last flex row, so it never covers the body.
       * On the property page the window scrolls, so `sticky bottom-0` holds it at the screen edge.
       * The bottom padding clears the home indicator (needs `viewportFit: 'cover'`, set in the root
       * layout). Each button is 44px tall.
       */}
      {requestKind !== null && (
        <BuyerAgentRequestDialog listingId={listing.id} kind={requestKind} onClose={closeRequest} />
      )}
      <div
        data-testid="listing-mobile-bar"
        hidden={!canRequest}
        className="sticky bottom-0 z-20 flex-shrink-0 border-t border-surface-border bg-white/95 shadow-[0_-4px_16px_rgba(0,0,0,0.08)] backdrop-blur-sm lg:hidden"
      >
        {/* No price here: the overview block holds it once (#568). */}
        <div className="flex gap-2 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
          <button
            type="button"
            className="btn-secondary min-h-11 flex-1 py-2 text-sm"
            onClick={onMessageAgent}
          >
            Message Agent
          </button>
          <button
            type="button"
            className="btn-primary min-h-11 flex-1 py-2 text-sm"
            onClick={onRequestTour}
          >
            Request a Tour
          </button>
        </div>
      </div>
    </div>
  );
}
