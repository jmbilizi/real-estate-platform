'use client';

import listings from '@/lib/listings';
import PropertyGallery from '@/components/PropertyGallery';
import AmenityChips from '@/components/AmenityChips';
import MortgageTeaser from '@/components/MortgageTeaser';
import ListingRow from '@/components/ListingRow';
import SingleListingMap from '@/components/SingleListingMap';
import { formatDate, formatNumber, formatPrice } from '@/lib/format';
import { useApp } from '@/lib/context';
import { Listing } from '@/lib/types';

interface Props {
  listing: Listing;
  /** Called when the back button is pressed */
  onClose?: () => void;
}

export default function ListingDetailContent({ listing, onClose }: Props) {
  const { toggleSave, isSaved } = useApp();
  const saved = isSaved(listing.id);

  const similar = listings
    .filter((l) => l.id !== listing.id && l.propertyType === listing.propertyType)
    .slice(0, 12);
  const similarHref = `/search?type=${listing.listingType}&q=${encodeURIComponent(`${listing.propertyType} ${listing.city}`)}`;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Airbnb-style: address + key stats left · Share/Save right — above gallery */}
      <div className="flex-shrink-0 flex items-center gap-3 px-6 sm:px-8 pt-4 pb-3 bg-white">
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
          <h1 className="font-display text-xs font-semibold tracking-tight text-ink sm:text-sm md:text-base lg:text-lg xl:text-xl">
            {listing.address}, {listing.city}, {listing.state} {listing.zip}
          </h1>
          <p className="mt-1 text-xs text-ink-muted lg:text-sm">
            {listing.beds} bed · {listing.baths} bath · {formatNumber(listing.sqft)} sqft ·{' '}
            {listing.propertyType}
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

      {/* Scrollable body */}
      <div className="flex-1 min-h-0 scrollbar-overlay px-6 sm:px-8 pb-8">
        {/* Gallery */}
        <PropertyGallery images={listing.imageUrls} title={listing.title} />

        <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_380px]">
          {/* Main column */}
          <div>
            {/* Price + status badges + address — below gallery */}
            <div>
              <div className="flex flex-wrap gap-1.5">
                <span className="badge bg-surface-border text-ink">{listing.status}</span>
                {listing.openHouse && (
                  <span className="badge bg-brand text-white">
                    Open House · {formatDate(listing.openHouse.date)}
                  </span>
                )}
                {listing.priceReduced && (
                  <span className="badge bg-amber-100 text-amber-800">Price Reduced</span>
                )}
                {listing.newConstruction && (
                  <span className="badge bg-emerald-100 text-emerald-800">New Construction</span>
                )}
              </div>
              <p className="mt-3 font-display text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
                {formatPrice(listing.price, listing.listingType)}
              </p>
              <p className="mt-2 text-lg font-medium text-ink">{listing.address}</p>
              <p className="text-ink-muted">
                {listing.city}, {listing.state} {listing.zip} · {listing.neighborhood}
              </p>
            </div>

            {/* Stats */}
            <div className="mt-6 grid grid-cols-2 gap-0 overflow-hidden rounded-2xl border border-surface-border bg-white sm:grid-cols-3 lg:grid-cols-6">
              {[
                { label: 'Beds', value: listing.beds },
                { label: 'Baths', value: listing.baths },
                { label: 'Sqft', value: formatNumber(listing.sqft) },
                { label: 'Type', value: listing.propertyType },
                ...(listing.yearBuilt ? [{ label: 'Year Built', value: listing.yearBuilt }] : []),
                ...(listing.lotSqft
                  ? [{ label: 'Lot Size', value: `${formatNumber(listing.lotSqft)} sf` }]
                  : []),
              ].map((s, i, arr) => (
                <div
                  key={s.label}
                  className={`px-5 py-4 ${i !== arr.length - 1 ? 'border-b border-surface-border sm:border-b-0 sm:border-r' : ''}`}
                >
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
                    {s.label}
                  </p>
                  <p className="mt-1 font-display text-lg font-bold text-ink">{s.value}</p>
                </div>
              ))}
            </div>

            {/* Description */}
            <div className="mt-10">
              <h2 className="font-display text-xl font-bold tracking-tight">About this home</h2>
              <p className="mt-3 leading-relaxed text-ink-muted">{listing.description}</p>
            </div>

            {/* Amenities */}
            <div className="mt-10">
              <h2 className="font-display text-xl font-bold tracking-tight">
                Features & Amenities
              </h2>
              <div className="mt-4">
                <AmenityChips amenities={listing.amenities} />
              </div>
            </div>

            {/* Where you'll live */}
            <div className="mt-10">
              <h2 className="font-display text-xl font-bold tracking-tight">
                Where you&apos;ll live
              </h2>
              <p className="mt-2 text-sm text-ink-muted">
                {listing.neighborhood}, {listing.city}, {listing.state}
              </p>
              <div className="mt-4 overflow-hidden rounded-2xl border border-surface-border">
                <SingleListingMap listing={listing} className="h-[380px] w-full" />
              </div>
            </div>

            {/* Listing disclosure */}
            <div className="mt-10 rounded-2xl border border-surface-border bg-surface-alt p-5 text-xs leading-relaxed text-ink-muted">
              <p>
                Listing courtesy of <strong className="text-ink">{listing.officeName}</strong>.
                Listed by {listing.listedBy}.
              </p>
              <p className="mt-1">
                Information provided by Bright MLS. Deemed reliable but not guaranteed. Data last
                updated: {formatDate(listing.lastUpdated)}.
              </p>
              <p className="mt-1">
                This information is for personal, non-commercial use. Some properties may no longer
                be available.
              </p>
            </div>
          </div>

          {/* Sidebar */}
          <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
            {/* Agent card */}
            <div className="rounded-2xl border border-surface-border bg-white p-6 shadow-card">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
                Listing Agent
              </p>
              <div className="mt-3 flex items-center gap-3">
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand-700 font-bold text-white">
                  {listing.brokerName[0]}
                </div>
                <div className="min-w-0">
                  <p className="truncate font-semibold text-ink">{listing.brokerName}</p>
                  <p className="truncate text-xs text-ink-muted">{listing.officeName}</p>
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
                {listing.officeBrokerLeadMail && (
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
                    {listing.officeBrokerLeadMail}
                  </p>
                )}
              </div>
              <button className="btn-primary mt-5 w-full">Schedule a Tour</button>
              <button className="btn-secondary mt-2 w-full">Message Agent</button>
            </div>

            {/* Open house */}
            {listing.openHouse && (
              <div className="rounded-2xl border border-brand/20 bg-brand-50 p-5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-700">
                  Upcoming Open House
                </p>
                <p className="mt-2 font-display text-lg font-bold text-ink">
                  {formatDate(listing.openHouse.date)}
                </p>
                <p className="text-sm text-ink-muted">
                  {listing.openHouse.startTime} – {listing.openHouse.endTime}
                </p>
                <button className="mt-3 text-sm font-semibold text-brand hover:underline">
                  + Add to calendar
                </button>
              </div>
            )}

            {/* Mortgage */}
            {listing.listingType === 'sale' && <MortgageTeaser price={listing.price} />}
          </aside>
        </div>

        {/* Similar homes */}
        {similar.length > 0 && (
          <div className="mt-4">
            <ListingRow
              title="Similar Homes"
              listings={similar}
              max={6}
              href={similarHref}
              sectionClassName="pt-6"
            />
          </div>
        )}
      </div>
      {/* end body wrapper */}

      {/* Mobile sticky CTA bar */}
      <div className="flex-shrink-0 border-t border-surface-border bg-white/95 shadow-[0_-4px_16px_rgba(0,0,0,0.08)] backdrop-blur-sm lg:hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="font-display text-lg font-extrabold leading-tight text-ink">
              {formatPrice(listing.price, listing.listingType).split('/')[0]}
            </p>
            {listing.listingType === 'rent' && <p className="text-xs text-ink-muted">/month</p>}
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
