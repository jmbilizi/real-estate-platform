import type { Media } from '@cribstop/property-contracts';
import { BRAND } from '@/lib/brand';

/**
 * A listing photo, or a branded placeholder when the row has none.
 *
 * `primaryMedia` is nullable and a null must never produce a broken `img` — a seller can suppress
 * photos, and #53 adds more such fields. Media is a `{ url, altText }` object and the `altText` is
 * what gets rendered: substituting the listing title would put marketing copy into the accessible
 * name of an image it does not describe.
 */
export default function ListingImage({
  media,
  className = '',
  sizeHint,
}: {
  media: Media | null;
  className?: string;
  /** Rendered inside the placeholder only; the real image needs no caption. */
  sizeHint?: 'card' | 'detail';
}) {
  if (!media) {
    return (
      <div
        className={`flex h-full w-full flex-col items-center justify-center gap-1 bg-surface-soft text-center ${className}`}
        role="img"
        aria-label="No photo available for this listing"
      >
        <svg
          className="h-6 w-6 fill-none stroke-ink-subtle"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 19.5h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5z"
          />
        </svg>
        <span className="px-2 text-[11px] text-ink-subtle">No photo available</span>
        {sizeHint === 'detail' && (
          <span className="px-2 text-[11px] text-ink-subtle">{BRAND.brokerage}</span>
        )}
      </div>
    );
  }

  // A plain <img> rather than next/image: listing photos come from arbitrary remote hosts supplied
  // by the data source, which next/image would require to be enumerated in next.config.js ahead of
  // time. Matches what the cards rendered before.
  return <img src={media.url} alt={media.altText ?? ''} loading="lazy" className={className} />;
}
