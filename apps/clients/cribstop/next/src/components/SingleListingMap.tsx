'use client';

import dynamic from 'next/dynamic';
import type { ListingType } from '@/lib/types';
import { hasMapCoordinates } from '@/lib/listing-format';

const Inner = dynamic(() => import('./SingleListingMapInner'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-surface-soft">
      <span className="text-sm text-ink-muted">Loading map…</span>
    </div>
  ),
});

export interface SingleListingMapProps {
  latitude: number | null;
  longitude: number | null;
  price: number | null;
  listingType: ListingType;
  className?: string;
}

/**
 * Renders a pin only when both coordinates are present.
 *
 * `latitude`/`longitude` are null together whenever the seller opted out of address display.
 * Falling back to a city or ZIP centroid would be fabricated precision that partially
 * re-identifies the address the seller withheld, so a missing pair renders an explanatory note
 * instead of ever guessing a point. `hasMapCoordinates` is the only gate — never a `?? city`
 * fallback here or in the caller.
 */
export default function SingleListingMap({
  latitude,
  longitude,
  price,
  listingType,
  className,
}: SingleListingMapProps) {
  // A local object (rather than the two loose variables above) so the type guard's narrowing
  // — `coords is { latitude: number; longitude: number }` — actually applies to what's passed
  // to `Inner` below.
  const coords = { latitude, longitude };

  if (!hasMapCoordinates(coords)) {
    return (
      <div
        className={`flex h-full w-full items-center justify-center bg-surface-soft px-6 text-center ${className ?? ''}`}
      >
        <p className="text-sm text-ink-muted">
          The exact location of this listing is not shown at the seller’s request.
        </p>
      </div>
    );
  }

  return (
    <Inner
      latitude={coords.latitude}
      longitude={coords.longitude}
      price={price}
      listingType={listingType}
      className={className}
    />
  );
}
