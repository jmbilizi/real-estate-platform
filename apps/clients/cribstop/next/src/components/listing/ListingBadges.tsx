/**
 * Labels that must be visible whenever the row they describe is visible.
 *
 * Both of these are disclosure obligations rather than decoration, so they are deliberately not
 * part of the single-slot badge rotation the card uses for "Price reduced" / "New construction" /
 * "Featured" — a marketing badge must never be able to win a slot from a required label.
 */

/**
 * PRD §6.3 sample labelling.
 *
 * `#21`'s `listing_search_v` OR-propagates `is_sample` across property, unit and listing so that a
 * fabricated address can never render unlabelled under a real listing. Until #33 lands **every**
 * row is a sample, so this is what the app shows rather than an edge case, and the label must not
 * be defeatable by a filter, a sort or a viewport: if a sample row is visible, its label is visible.
 */
export function SampleBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full bg-ink px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white ${className}`}
    >
      Sample data
    </span>
  );
}

/**
 * FTC / PRD §6 paid-placement disclosure.
 *
 * `recommended` ranks featured listings first, so a paid placement shown as organic ranking is a
 * disclosure failure. This label is the one thing that must be true before any paid placement can
 * exist — which is why it is driven by the row's own `sponsored` flag rather than by `featured`.
 */
export function SponsoredBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full bg-surface-alt px-2 py-0.5 text-[11px] font-semibold text-ink-body ring-1 ring-surface-border ${className}`}
    >
      Sponsored
    </span>
  );
}
