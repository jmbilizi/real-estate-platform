/**
 * The one hover of every results card (#526, #550): listing card, neighborhood card and the See
 * all tiles. The halo is a `before:` overlay 10px outside the card, so it wraps the photo too.
 * It sits behind the content (`isolate` + `-z-10`), so it never changes layout. The `hover`
 * media query keeps a touch device from holding a sticky hover. The keyboard focus ring uses the
 * same halo shape. A carousel scroller pads its edges so the halo is not clipped.
 */
export const CARD_HOVER_CLASS =
  "relative isolate before:pointer-events-none before:absolute before:-inset-2.5 before:-z-10 before:rounded-xl before:transition-shadow before:duration-150 before:content-[''] [@media(hover:hover)]:hover:before:bg-black/[0.03] [@media(hover:hover)]:hover:before:shadow-[0_2px_12px_rgba(0,0,0,0.1)] focus-visible:outline-none focus-visible:before:ring-2 focus-visible:before:ring-ink";

/** The marker-sync highlight (#503). A highlight, not a hover: a mid-dark border and the quiet shadow. */
export const CARD_ACTIVE_CLASS = 'border-ink/60 shadow-[0_2px_10px_rgba(0,0,0,0.08)]';
