import type { Attribution, ListingSource } from '@cribstop/property-contracts';

/**
 * Listing attribution, at the density the surface calls for.
 *
 * **NAR Policy Statement 7.58 governs IDX displays** — displays of *other participants'* listings
 * obtained through an MLS IDX feed. It requires the listing firm plus a listing-participant-supplied
 * email or phone, reasonably prominent, in a typeface not smaller than the median used for the
 * listing data, and it applies to search results rather than only detail pages. That reasoning is
 * still correct and still governs the `density="full"` block kept below.
 *
 * **Stakeholder ruling, 2026-09-22 (#305): every card shows one line, whatever the row's
 * `source`.** Card surfaces (search card, map popup) no longer branch on `source`. Every card
 * renders `Listing courtesy of {officeName}` — no listing agent name, no phone, no email, no
 * `listedBy` line, `brightMLS` rows included. This is a business decision to accept the risk of a
 * firm-only IDX card, not a finding that 7.58 no longer applies to an IDX row. #306 (human-action)
 * asks Real Broker LLC and Bright MLS to confirm firm-only attribution is acceptable on a card
 * before a live Bright row ships; #33 and #146 (Bright content and display rules) are blocked on
 * that answer. Until #306 closes, treat the 7.58 contact-method obligation as unresolved for cards,
 * not satisfied by this file.
 *
 * - Card surfaces, any `source`, `density="auto"` (the default) → `Listing courtesy of
 *   {officeName}`, always, per the ruling above.
 * - `density="courtesy"` (the detail page, out of scope for #305) → unchanged: a `brightMLS` row
 *   still gets the full block below instead of the one-sentence disclosure, exactly as before
 *   #305. A non-`brightMLS` row gets the one-sentence disclosure, also unchanged.
 * - `density="full"` → the full IDX block: listing agent name, at least one contact method, and
 *   the office name, at the 14px median floor (the card's listing data is 14px location / 12px
 *   stats / 14px price, so the median is 14px). No surface passes this prop directly; it stays in
 *   the code, reachable and tested, so widening it back onto cards if #306 comes back "contact
 *   method required" is a prop change on the card call sites, not a rewrite.
 *
 * `listedBy` is derived server-side and rendered as delivered — never reassembled from parts here,
 * or the display string could disagree with the attribution it came from.
 *
 * `compact` bounds the full IDX block for a height-constrained surface (the search card, the map
 * popup). It is independent of `density`: `density` decides *which* block renders, `compact` decides
 * how the full block's own lines are laid out once chosen. Each fact (`listedBy`, contact, courtesy
 * of office) becomes its own single truncated line with a `title` attribute carrying the full text,
 * matching the reduced branch's existing pattern for `officeName`. The redundant standalone
 * `listingAgentName` line is dropped in this mode, because the name is already inside `listedBy`.
 *
 * `compact` also always renders the courtesy-of-office line, even when `listedBy` already ends
 * with `officeName` (the case the non-compact branch skips as a stutter). `listedBy` is
 * `"<agent> – <office>"`, so the office name sits at the tail, exactly where a truncated single
 * line clips first — the firm name could otherwise disappear from view entirely, with only a
 * hover-only `title` carrying it, which does not satisfy 7.58's "reasonably prominent". The
 * courtesy line has its own `title` and is never truncated away, so the firm stays visible.
 */
export default function ListingAttribution({
  attribution,
  source,
  density = 'auto',
  compact = false,
  className = '',
}: {
  attribution: Attribution;
  source: ListingSource;
  /**
   * `auto` (the default) renders the one-line courtesy form for every `source`. `full` renders the
   * complete IDX block regardless of `source` — see the header comment. `courtesy` renders the
   * one-sentence disclosure form (firm + who listed it, no contact details), used by the detail
   * page.
   */
  density?: 'auto' | 'full' | 'courtesy';
  /** Bounds the full IDX block to one truncated line per fact. See the doc comment above. */
  compact?: boolean;
  className?: string;
}) {
  const { listedBy, officeName, listingAgentName, brokerPhone, brokerEmail } = attribution;

  /*
   * #305: a card (`density="auto"`, the default) never shows the full block, whatever `source`
   * is — that is the whole point of the ruling. The detail page (`density="courtesy"`) is out of
   * scope for #305, so a `brightMLS` row there still gets the full block instead of the courtesy
   * sentence, exactly as before. `density="full"` is the explicit, source-independent override.
   */
  const showFullBlock = density === 'full' || (density === 'courtesy' && source === 'brightMLS');

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
         * #305: every card, every `source`, one line. Office names run long ("Long & Foster Real
         * Estate, Inc. — Bethesda Gateway"), and a wrapped second line makes this card taller than
         * every other tile in the grid, which is the uniform-height problem all over again. One
         * line, ellipsized. `truncate` is CSS only, so the full name stays in the DOM and screen
         * readers still read it whole; `title` exposes it on hover for sighted users.
         */
        className={`truncate text-[13px] leading-snug text-ink-muted ${className}`}
        title={officeName}
      >
        Listing courtesy of {officeName}
      </p>
    );
  }

  // At least one contact method is required. The contract guarantees `brokerPhone` and
  // `brokerEmail` are non-nullable on every row, so this is a floor, not a best effort.
  const contact = brokerPhone || brokerEmail;
  const contactText = [brokerPhone, brokerEmail].filter(Boolean).join(' · ');
  const courtesyText = `Listing courtesy of ${officeName}`;

  /*
   * `truncate` clips visually only; the full text stays in the DOM for screen readers. `title`
   * exposes it on hover for sighted users — always the full displayed line, matching the reduced
   * branch's `officeName` line, so every compact line behaves the same way on hover.
   */
  const compactLineProps = (fullText: string) =>
    compact ? { className: 'truncate', title: fullText } : {};

  return (
    <div className={`text-sm leading-snug text-ink-body ${className}`}>
      <p {...compactLineProps(listedBy)}>{listedBy}</p>
      {!compact && listingAgentName && listedBy !== listingAgentName && <p>{listingAgentName}</p>}
      {contact && (
        <p {...compactLineProps(contactText)}>
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
       * Listing courtesy of Real Broker, LLC"). Outside `compact`, the line is skipped whenever
       * `listedBy` already ends with the office name, because that copy is unbounded and legible
       * there.
       *
       * `compact` always renders this line instead, even on that same `endsWith` case. The
       * `listedBy` line above is truncated in `compact`, and it ends in "<agent> – <office>", so
       * the office name sits exactly where a single-line ellipsis clips first — the firm name could
       * disappear from view with nothing but a hover-only `title` carrying it, which is not
       * "reasonably prominent" per 7.58. This line has its own `title` and is never truncated away,
       * so the firm identification stays visible regardless of what `listedBy` clips.
       *
       * Not truncated outside `compact`: 7.58 requires the listing firm to be identified and
       * reasonably prominent, and an ellipsized firm name is arguably neither, so this line wraps
       * rather than clips by default. `compact` truncates it anyway, on a `title`-carried full
       * name, because a height-constrained card cannot afford a wrapped second line at all — the
       * name stays in the DOM either way, so the disclosure itself is not dropped, only clipped in
       * presentation, and the surface stays bounded per the ticket's acceptance criteria.
       */}
      {(compact || !listedBy.endsWith(officeName)) && (
        <p {...compactLineProps(courtesyText)}>{courtesyText}</p>
      )}
    </div>
  );
}
