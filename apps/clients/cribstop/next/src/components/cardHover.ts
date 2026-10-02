/**
 * The one hover of every results card (#526): listing card, neighborhood card and the See all
 * tiles. A soft shadow only, so nothing moves. The `hover` media query keeps a touch device from
 * holding a sticky hover. The focus ring stays stronger than this shadow.
 */
export const CARD_HOVER_CLASS =
  'transition-shadow duration-150 [@media(hover:hover)]:hover:shadow-[0_2px_10px_rgba(0,0,0,0.08)]';

/** The marker-sync highlight (#503). A highlight, not a hover: a mid-dark border and the quiet shadow. */
export const CARD_ACTIVE_CLASS = 'border-ink/60 shadow-[0_2px_10px_rgba(0,0,0,0.08)]';
