'use client';

import Link from 'next/link';
import { Listing } from '@/lib/types';
import { formatPrice } from '@/lib/format';
import { useApp } from '@/lib/context';

export default function ListingCard({ listing }: { listing: Listing }) {
  const { toggleSave, isSaved } = useApp();
  const saved = isSaved(listing.id);

  const badge = listing.openHouse
    ? { label: 'Open house', tone: 'bg-white/95 text-ink' }
    : listing.priceReduced
      ? { label: 'Price reduced', tone: 'bg-brand text-white' }
      : listing.newConstruction
        ? { label: 'New construction', tone: 'bg-emerald-600 text-white' }
        : listing.featured
          ? { label: 'Featured', tone: 'bg-ink text-white' }
          : null;

  return (
    <Link href={`/listing/${listing.id}`} className="group block" prefetch>
      {/* Image */}
      <div className="relative aspect-square overflow-hidden rounded-2xl bg-surface-soft">
        {}
        <img
          src={listing.imageUrls[0]}
          alt={listing.title}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
        />

        {badge && (
          <span
            className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-[11px] font-semibold shadow-sm ${badge.tone}`}
          >
            {badge.label}
          </span>
        )}

        {/* Heart */}
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleSave(listing.id);
          }}
          className="absolute right-3 top-3 transition hover:scale-110"
          aria-label={saved ? 'Unsave' : 'Save'}
        >
          <svg
            className={`h-7 w-7 drop-shadow ${saved ? 'fill-brand stroke-white' : 'fill-black/40 stroke-white'}`}
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
      <div className="pt-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate font-semibold text-ink">
            {listing.neighborhood}, {listing.city}
          </h3>
          {listing.openHouse && (
            <span className="flex flex-shrink-0 items-center gap-1 text-xs text-ink-muted">
              <svg className="h-3 w-3 fill-ink" viewBox="0 0 24 24">
                <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
              </svg>
              Open
            </span>
          )}
        </div>
        <p className="truncate text-sm text-ink-muted">{listing.address}</p>
        <p className="text-sm text-ink-muted">
          {listing.beds} bd · {listing.baths} ba · {listing.sqft.toLocaleString()} sqft
        </p>
        <p className="mt-1 text-ink">
          <span className="font-semibold">
            {formatPrice(listing.price, listing.listingType).split('/')[0]}
          </span>
          {listing.listingType === 'rent' && <span className="text-ink-muted"> /month</span>}
        </p>
        <p className="mt-0.5 truncate text-[11px] text-ink-subtle">
          Listing courtesy of {listing.officeName}
        </p>
      </div>
    </Link>
  );
}
