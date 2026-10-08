'use client';

import Link from 'next/link';
import { Heart, Home } from 'lucide-react';
import type { SavedHome } from '@cribstop/property-contracts';
import { SampleBadge } from '@/components/listing/ListingBadges';
import { formatCardAddress, formatDwellingStats, formatLotSize } from '@/lib/listing-format';

/**
 * A saved home with no consumer-visible listing (#25, #23). It is a first-class card, not an error
 * state: the saved home outlives its listing. It draws the durable facts only. It has no price
 * line, because a price exists only on a listing and the listing view may have withheld it. The
 * address and its masking come from the API, and `formatCardAddress` shows no street, no ZIP and
 * no centroid when the address is null. The page never shows an estimate or an inferred value.
 *
 * The layout mirrors `ListingCard` (image block, then a price-line-height body) so a grid that
 * mixes both stays one height, and so the page skeleton stays accurate.
 */
export default function OffMarketHomeCard({
  home,
  onRemove,
}: {
  home: SavedHome;
  onRemove: (propertyId: string) => void;
}) {
  const { property } = home;
  const isLand = property.propertyType === 'Land';
  const stats = isLand
    ? formatLotSize(property.lotSqft)
    : formatDwellingStats(property.beds, property.baths, property.sqft);

  const facts = (
    <>
      <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-md bg-surface-alt">
        <Home aria-hidden="true" size={40} className="text-ink-muted" />
        <span className="absolute left-2 top-2 rounded-full bg-ink px-2 py-0.5 text-[11px] font-semibold text-white">
          Not currently listed
        </span>
      </div>
      <div className="pt-1.5">
        {property.isSample && (
          <div className="mb-1 flex h-5 items-center">
            <SampleBadge />
          </div>
        )}
        <p className="truncate text-base font-semibold text-ink">
          {formatCardAddress(property)}
          {property.unitNumber ? ` #${property.unitNumber}` : ''}
        </p>
        <p className="truncate text-sm text-ink-body">
          {[property.propertyType, stats].filter(Boolean).join(' · ')}
        </p>
        <p className="text-sm text-ink-muted">Not on the market right now. We keep it saved.</p>
      </div>
    </>
  );

  return (
    <article className="relative" data-off-market data-property-id={home.propertyId}>
      {home.canonicalPath ? (
        <Link href={home.canonicalPath} className="block">
          {facts}
        </Link>
      ) : (
        <div>{facts}</div>
      )}
      <button
        type="button"
        onClick={() => onRemove(home.propertyId)}
        className="absolute right-1 top-1 flex h-11 w-11 items-center justify-center rounded-full text-white drop-shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        aria-label="Unsave"
      >
        <Heart size={20} className="fill-brand stroke-white" />
      </button>
    </article>
  );
}
