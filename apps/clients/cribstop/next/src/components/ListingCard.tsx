'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Listing } from '@/lib/types';
import { formatPrice } from '@/lib/format';
import { useApp } from '@/lib/context';

export default function ListingCard({ listing }: { listing: Listing }) {
  const { toggleSave, isSaved } = useApp();
  const saved = isSaved(listing.id);
  const router = useRouter();
  const pathname = usePathname();

  const openModal = () => {
    const params = new URLSearchParams(window.location.search);
    params.set('listing', listing.id);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const badgeLabel = listing.openHouse
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
        {}
        <img
          src={listing.imageUrls[0]}
          alt={listing.title}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
        />

        {badgeLabel && (
          <span className="absolute left-3 top-3 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-ink shadow-card">
            {badgeLabel}
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
        <div className="flex items-start justify-between gap-1.5">
          <h3 className="truncate text-sm font-semibold text-ink">
            {listing.neighborhood}, {listing.city}
          </h3>
          {listing.openHouse && (
            <span className="flex flex-shrink-0 items-center gap-1 text-[11px] text-ink-muted">
              <svg className="h-2.5 w-2.5 fill-ink" viewBox="0 0 24 24">
                <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
              </svg>
              Open
            </span>
          )}
        </div>
        <p className="truncate text-xs text-ink-muted">
          {listing.beds} bd · {listing.baths} ba · {listing.sqft.toLocaleString()} sqft
        </p>
        <p className="mt-0.5 text-sm text-ink">
          <span className="font-semibold">
            {formatPrice(listing.price, listing.listingType).split('/')[0]}
          </span>
          {listing.listingType === 'rent' && <span className="text-ink-muted"> /month</span>}
        </p>
        <p className="mt-1 truncate rounded-sm bg-surface-alt px-1.5 py-0.5 text-[11px] text-ink-muted">
          Listing courtesy of {listing.officeName}
        </p>
      </div>
    </div>
  );
}
