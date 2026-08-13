import type { Attribution } from '@cribstop/property-contracts';

/**
 * NAR Policy Statement 7.58 attribution.
 *
 * IDX displays must identify the listing firm and a listing-participant-supplied email or phone,
 * reasonably prominent and in a typeface **not smaller than the median** used for the listing data
 * — and the policy applies to **search results**, not only detail pages. The card previously
 * rendered `Listing courtesy of {officeName}` at 11px with no agent name and no contact method,
 * which met none of those three requirements.
 *
 * Typeface floor: the card's listing data renders at 14px (location), 12px (the bed/bath/sqft
 * line) and 14px (price). The median of those is **14px**, so this component renders at `text-sm`
 * and no variant may go below it. That is why there is no `compact`/`dense` size prop here: a
 * denser card is a layout decision, and this floor is not a layout decision.
 *
 * `listedBy` is derived server-side and is rendered as delivered — never reassembled from parts
 * here, or the display string could disagree with the attribution it came from.
 */
export default function ListingAttribution({
  attribution,
  className = '',
}: {
  attribution: Attribution;
  className?: string;
}) {
  const { listedBy, officeName, listingAgentName, brokerPhone, brokerEmail } = attribution;

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
       * Listing courtesy of Real Broker, LLC"). The line is still rendered whenever `listedBy` does
       * NOT already end with the office name, because 7.58 requires the listing firm to be
       * identified and `listedBy` is not guaranteed to carry it.
       */}
      {!listedBy.endsWith(officeName) && <p>Listing courtesy of {officeName}</p>}
    </div>
  );
}
