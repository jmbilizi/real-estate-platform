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
 * **The two branches word the firm line differently, on purpose.** The reduced branch says "Listing
 * by {officeName}"; the full block says "Listing courtesy of {officeName}". Wording our own
 * inventory is a free choice, so the reduced branch uses plain English. Wording an IDX display is
 * not necessarily ours to make — Bright's display rules may prescribe it — so the full block keeps
 * the conventional IDX phrasing, which is what an MLS rulebook is most likely to expect, and the
 * invented wording stays on the branch where inventing is allowed. Settling the IDX string for good
 * is #33's job, along with the rest of the display rules and broker sign-off. No Bright row exists
 * yet, so nothing is misattributed today — but do not treat the full block's string as settled.
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
  /**
   * `auto` follows the row's source; `full` always renders the complete block; `courtesy` renders
   * the one-sentence disclosure form (firm + who listed it, no contact details).
   */
  density?: 'auto' | 'full' | 'courtesy';
  className?: string;
}) {
  const { listedBy, officeName, listingAgentName, brokerPhone, brokerEmail } = attribution;

  /*
   * An IDX row always gets the full block, whatever density the surface asked for.
   *
   * This check comes **before** `courtesy` on purpose. When `courtesy` was evaluated first it was
   * the one path in the app where a `brightMLS` row rendered without a contact method — the exact
   * branch this file's header calls non-negotiable — and because every row is `internal` today the
   * omission would not have shown up until #33 shipped it to production. A density is a request
   * about layout; it cannot waive an obligation the row's own `source` creates.
   */
  const showFullBlock = density === 'full' || source === 'brightMLS';

  /*
   * The disclosure form, for a surface that already identifies the agent elsewhere.
   *
   * The detail page carries a Listing Agent card with the name, office, phone and email, so
   * repeating all of it in the disclosure block below was duplication, not compliance. NAR 7.58
   * asks that the **display** identify the listing firm and a participant-supplied contact
   * method, not that every block on the page do so independently — and the agent card satisfies
   * it in a far more prominent position than a footnote. What belongs here is the courtesy
   * attribution itself: which firm the listing came from, and who listed it.
   *
   * `text-sm` is set here rather than inherited. Attribution must not fall below the median type
   * size used for the listing data, and inheriting left this line at the enclosing panel's 13px
   * against a measured median of 14px on the rebuilt detail page — a floor missed by a pixel is
   * still missed, and one that depends on an ancestor's font size is one the next layout change
   * breaks silently.
   *
   * `listedBy` is rendered as delivered, never reassembled from parts.
   */
  if (density === 'courtesy' && !showFullBlock) {
    return (
      <p className={`text-sm leading-snug ${className}`}>
        Listing courtesy of {officeName}. Listed by {listedBy}.
      </p>
    );
  }

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
        className={`truncate text-[13px] leading-snug text-ink-muted ${className}`}
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
       *
       * "Listing courtesy of" rather than the "Listing by" used in the reduced branch. On our own
       * inventory the wording is a free choice; on an IDX display it is not necessarily ours to
       * make — Bright's display rules may prescribe it, and settling that is #33's job with broker
       * sign-off. So this branch keeps the conventional IDX phrasing, which is what an MLS rulebook
       * is most likely to expect, and the invented wording stays on the branch where inventing is
       * allowed.
       */}
      {!listedBy.endsWith(officeName) && <p>Listing courtesy of {officeName}</p>}
    </div>
  );
}
