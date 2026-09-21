/**
 * Shared skeleton primitives.
 *
 * Both are painted with `bg-surface-soft skeleton-fill` — the same pairing `FILL` uses in
 * `listing/ListingStates.tsx`, driven by `--skeleton-tint` on `:root`. One token, so the header,
 * the search bar and the listing cards all sweep in the same colour and on the same clock rather
 * than each inventing a loading look of its own.
 */

/**
 * A placeholder for a run of **text**, sized from the line box it is written inside.
 *
 * `inline-block` + `&nbsp;` makes the span exactly one line of whatever type scale its parent uses,
 * and the visible bar is inset within that line. So it measures correctly at every breakpoint
 * without naming any of them, and — the part that matters in the header — it cannot change the
 * geometry of what contains it. The search bar's large↔pill morph is driven by measured widths and
 * heights; a placeholder that changed either would show as the bar jumping mid-animation.
 *
 * Give it a width class (`w-20`, `w-full`); the height comes from the type scale.
 */
export function SkeletonBar({ className = '' }: { className?: string }) {
  return (
    <span className={`relative inline-block align-middle ${className}`} aria-hidden="true">
      &nbsp;
      <span className="absolute inset-x-0 top-1/2 h-[0.85em] -translate-y-1/2 rounded-xs bg-surface-soft skeleton-fill" />
    </span>
  );
}

/**
 * A placeholder for a **shape** — an icon, an avatar, a control — where the size is the element's
 * own rather than its text's. Pass the full box: `h-5 w-5`, `h-10 w-10 rounded-full`.
 */
export function SkeletonBlock({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`block flex-shrink-0 bg-surface-soft skeleton-fill ${className}`}
    />
  );
}

/**
 * A run of text that is either a placeholder or the real thing — and, crucially, the transition
 * between them.
 *
 * Both halves of the swap live here so no call site can take the placeholder without also taking
 * the fade. Snapping from grey to text reads as a flicker, and it reads *worse* the faster the
 * connection: on a warm load the placeholder is on screen just long enough to register as a blink
 * before being replaced in a single frame. `content-resolved` (globals.css) settles it in over
 * 180ms instead, opacity only, so nothing moves at the moment of the swap.
 *
 * `width` is the placeholder's width class; the height comes from the parent's type scale, so the
 * bar and the text it stands in for occupy exactly the same line box.
 */
export function SkeletonText({
  loading,
  width,
  children,
}: {
  loading: boolean;
  width: string;
  children: React.ReactNode;
}) {
  if (loading) return <SkeletonBar className={width} />;
  return <span className="content-resolved">{children}</span>;
}
