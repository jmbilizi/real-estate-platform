/**
 * The app's stacking order, in one place.
 *
 * Every `position: fixed` surface that can be on screen at the same time as another one is listed
 * here, in the order they must paint. Nothing outside this file may invent a competing value: a
 * number chosen next to the component that needs it is a number chosen without seeing the surfaces
 * it has to sit above, which is exactly how the bug this file exists to prevent happened.
 *
 * **The bug.** The docked search bar was given `zIndex: 55` so it would sit above the sticky header
 * (50) it docks into — correct in itself. But `Modal` was `z-50`, so *every dialog in the app* was
 * below the search bar. Scroll a results page far enough to dock the pill, open a listing or the
 * filter dialog, and the pill painted on top of it: measured with `elementFromPoint` (the pill won
 * the hit test over both dialogs) and by sampling pixels (the header dimmed to 0.70 of its unveiled
 * colour under the modal's `bg-black/30`, while the pill's pixels were byte-identical open and
 * closed — it was not behind the veil at all). Present since the docked pill was introduced in #20.
 *
 * **The rule that fixes it, and should keep it fixed:** page chrome — the header and the search bar
 * that docks into it — is below `dialog`. A dialog is a surface the user must deal with before
 * returning to the page, so nothing belonging to the page may paint over it. Only genuinely
 * app-global surfaces (a slide-in panel, toasts) sit above.
 *
 * Values are spaced so a new layer can be slotted between two existing ones without renumbering.
 *
 * Deliberately excluded: z-indexes that are *scoped inside* one of these surfaces and therefore
 * cannot collide with anything here — the search bar's own dropdown panels, the gallery lightbox
 * inside a dialog, the map's controls and overlays. Those live in their component's own stacking
 * context and are its business alone.
 */
export const Z_LAYERS = {
  /** Click-away catcher behind the expanded search bar — just under the chrome it dismisses. */
  navBackdrop: 49,
  /** The sticky site header. */
  chrome: 50,
  /** The search bar once docked (`position: fixed`), above the header it sits in. */
  searchBar: 55,
  /**
   * The clone that covers the real bar while a large↔pill morph dissolves. Must be directly above
   * `searchBar` and nothing else, or the two layouts' labels are briefly legible at once.
   */
  searchBarMorphGhost: 56,
  /** The full-screen mobile search experience. Still page chrome: a dialog covers it. */
  searchOverlay: 60,
  /** Modals: listing detail, auth, filters. Above all page chrome, by the rule above. */
  dialog: 70,
  /** App-global slide-in panel, which may be summoned over a dialog. */
  slidePanel: 100,
  /** Toasts: always visible, whatever else is open. */
  toast: 9999,
} as const;
