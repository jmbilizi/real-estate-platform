/**
 * The frame every map sits in — one definition, because it used to have three.
 *
 * `ListingsMapInner` styled its own root with `rounded-3xl` (24px), its caller passed
 * `md:rounded-2xl` (16px), and an inline `style={{ borderRadius: 28 }}` quietly beat both — so the
 * radius was 28px at every breakpoint and the two class-based declarations were dead code that read
 * as if they were doing something.
 *
 * More importantly the frame lived *inside* the lazily-loaded map, so the loading placeholder had
 * none of it: a flat, square, borderless grey box standing in for a rounded panel with a border and
 * a deep shadow. The shape appeared to change when the map arrived because it genuinely did.
 *
 * The frame now belongs to the wrapper, which is server-rendered and never lazy, so the panel is
 * the correct shape from the first paint and the map simply fills it.
 *
 * The background is the map canvas's own colour rather than a generic surface tone, so the tiles
 * fading in do not also change the panel's fill.
 */
export const MAP_PANEL_CLASS =
  'relative z-0 overflow-hidden rounded-[28px] border border-neutral-200 bg-[#f2ede6] ' +
  'shadow-[0_8px_32px_rgba(34,34,34,0.18),0_1.5px_8px_rgba(0,0,0,0.08)]';
