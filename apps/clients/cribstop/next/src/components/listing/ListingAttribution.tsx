import type { Attribution, ListingSource } from '@cribstop/property-contracts';

/**
 * Listing attribution, at the density the row's provenance actually requires.
 *
 * **NAR Policy Statement 7.58 governs IDX displays** — displays of *other participants'* listings
 * obtained through an MLS IDX feed. It requires the listing firm plus a listing-participant-supplied
 * email or phone, reasonably prominent, in a typeface not smaller than the median used for the
 * listing data, and it applies to search results rather than only detail pages.
 *
 * A brokerage displaying **its own** listings is not making an IDX display, so 7.58 does not attach.
 * Every row today is `source: 'internal'` and there is no Bright content licence yet (#33), which is
 * why the full block is not currently required — and why this is driven off the row's `source`, the
 * same way `ListingProvenance` is. When Bright content starts flowing, the full block turns on as
 * **data**, not as a card rewrite. That is the whole point of the split: the obligation is switched
 * on by the thing that creates it.
 *
 * - `source === 'brightMLS'` → the full block: listing agent name, at least one contact method, and
 *   the office name, at the 14px median floor (the card's listing data is 14px location / 12px
 *   stats / 14px price, so the median is 14px). This branch is non-negotiable and must be what
 *   ships the moment #33 lands.
 * - `source === 'internal' | 'other'` → `Listing by {officeName}`. Still attributed on every card
 *   and detail view per PRD §6.2, just without the IDX-specific contact requirements that do not
 *   apply to our own inventory.
 *
 * The wording is "Listing by" rather than the IDX-conventional "Listing courtesy of". For our own
 * inventory that is a free choice. For `brightMLS` rows it is not necessarily: Bright's display
 * rules may prescribe the attribution wording, and confirming that is #33's job along with the rest
 * of the display rules and broker sign-off. No Bright row exists yet, so nothing is misattributed
 * today — but do not treat this string as settled for the `brightMLS` branch.
 *
 * `density="full"` overrides the reduction for surfaces that are not height-constrained (the detail
 * page), where more attribution is never the risk.
 *
 * `listedBy` is derived server-side and rendered as delivered — never reassembled from parts here,
 * or the display string could disagree with the attribution it came from.
 */
export default function ListingAttribution({
  attribution,
  source,
  density = 'auto',
  className = '',
}: {
  attribution: Attribution;
  source: ListingSource;
  /** `auto` follows the row's source; `full` always renders the complete block. */
  density?: 'auto' | 'full';
  className?: string;
}) {
  const { listedBy, officeName, listingAgentName, brokerPhone, brokerEmail } = attribution;

  const showFullBlock = density === 'full' || source === 'brightMLS';

  if (!showFullBlock) {
    return (
      <p
        /*
         * Office names run long ("Long & Foster Real Estate, Inc. — Bethesda Gateway"), and a
         * wrapped second line makes this card taller than every other tile in the grid, which is
         * the uniform-height problem all over again. One line, ellipsized. `truncate` is CSS only,
         * so the full name stays in the DOM and screen readers still read it whole; `title` exposes
         * it on hover for sighted users.
         */
        className={`truncate text-xs leading-snug text-ink-muted ${className}`}
        title={officeName}
      >
        Listing by {officeName}
      </p>
    );
  }

  // At least one contact method is required. The contract guarantees `brokerPhone` and
  // `brokerEmail` are non-nullable on every row, so this is a floor, not a best effort.
  const contact = brokerPhone || brokerEmail;

  return (
    <div className={`text-sm leading-snug text-ink-body ${className}`}>
      <p>{listedBy}</p>
      {listingAgentName && listedBy !== listingAgentName && <p>{listingAgentName}</p>}
      {contact && (
        <p>
          {brokerPhone && (
            <a href={`tel:${brokerPhone.replace(/[^\d+]/g, '')}`} className="hover:underline">
              {brokerPhone}
            </a>
          )}
          {brokerPhone && brokerEmail && <span aria-hidden="true"> · </span>}
          {brokerEmail && (
            <a href={`mailto:${brokerEmail}`} className="hover:underline">
              {brokerEmail}
            </a>
          )}
        </p>
      )}
      {/*
       * `listedBy` is derived server-side as `<agent or broker> – <office>`, so it usually already
       * names the office and repeating it reads as a stutter ("Jane Agent – Real Broker, LLC /
       * Listing by Real Broker, LLC"). The line is still rendered whenever `listedBy` does NOT
       * already end with the office name, because 7.58 requires the listing firm to be identified
       * and `listedBy` is not guaranteed to carry it.
       *
       * Deliberately NOT truncated, unlike the reduced branch above: 7.58 requires the listing firm
       * to be identified and reasonably prominent, and an ellipsized firm name is arguably neither.
       * This branch is the one carrying that obligation, so it wraps rather than clips.
       */}
      {!listedBy.endsWith(officeName) && <p>Listing by {officeName}</p>}
    </div>
  );
}
