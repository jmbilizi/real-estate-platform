'use client';

import type { ListingDetailView } from '@/lib/api/listings';
import { formatNewListingAge } from '@/lib/format';
import { formatComingSoonBadge } from '@/lib/listing-format';
import { useMinuteClock } from '@/lib/useMinuteClock';

type Props = Pick<
  ListingDetailView,
  'status' | 'listingType' | 'listedAt' | 'listedAtPrecise' | 'comingSoonDate'
> & {
  /** The property page's market status. 'Under Contract' has no consumer status (#349). */
  statusLabel?: string;
};

/** The status words on the photo. `Active` reads as the offer: for sale or for rent. */
function statusText(status: string, listingType: Props['listingType']): string {
  if (status === 'Active') return listingType === 'rent' ? 'For rent' : 'For sale';
  if (status === 'Under Contract') return 'Under contract';
  return status;
}

/**
 * #565. The listing status, top left of the photo gallery.
 *
 * The age shows only under 7 days (`formatNewListingAge`), and never for Coming Soon or Sold,
 * the same rules as the listing card.
 */
export default function GalleryStatusBadge({
  status,
  listingType,
  listedAt,
  listedAtPrecise,
  comingSoonDate,
  statusLabel,
}: Props) {
  const label = statusLabel ?? status;
  const isComingSoon = label === 'Coming Soon';
  const isSold = label === 'Sold' || listingType === 'sold';
  const showAge = !isComingSoon && !isSold;

  // The shared clock is null until hydration ends, so the first render is the day bucket.
  const minuteNow = useMinuteClock(showAge && listedAtPrecise !== null);
  const age = showAge
    ? formatNewListingAge(
        listedAt,
        minuteNow ?? Date.now(),
        minuteNow === null ? null : listedAtPrecise,
      )
    : null;

  const text = isComingSoon
    ? formatComingSoonBadge(comingSoonDate)
    : statusText(label, listingType);

  return (
    <span
      data-testid="gallery-status-badge"
      className="inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-ink shadow-card"
    >
      <span
        aria-hidden="true"
        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-brand"
      />
      {age ? `${text} · ${age}` : text}
    </span>
  );
}
