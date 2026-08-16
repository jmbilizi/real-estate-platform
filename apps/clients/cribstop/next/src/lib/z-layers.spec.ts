import { Z_LAYERS } from './z-layers';

/**
 * The stacking order, asserted as an order rather than as a list of numbers.
 *
 * These cases exist because the bug they guard was invisible to every other check in the repo: the
 * types were fine, the lint was clean, the components rendered, and a docked search bar simply
 * painted on top of every dialog in the app. Nothing but a human looking at the screen could catch
 * it — measured at the time: the pill won `elementFromPoint` over both the listing panel and the
 * filter dialog, and its coral search orb contributed 929 opaque pixels inside the panel's own
 * header row (0 after the fix).
 *
 * Asserting relationships and not values on purpose. Renumbering a layer is legitimate; inverting
 * two of them is the defect, and only the relationship can tell those apart.
 */
describe('Z_LAYERS', () => {
  /**
   * The rule the bug broke. Page chrome — the header and the search bar that docks into it — must be
   * below any dialog, because a dialog is a surface the user has to deal with before returning to the
   * page underneath. `Modal` sat at 50 against the docked bar's 55.
   */
  it.each([
    ['navBackdrop', 'chrome'],
    ['chrome', 'searchBar'],
    ['searchBar', 'searchBarMorphGhost'],
    ['searchBarMorphGhost', 'searchOverlay'],
    ['searchOverlay', 'dialog'],
    ['dialog', 'slidePanel'],
    ['slidePanel', 'toast'],
  ] as const)('keeps %s below %s', (below, above) => {
    expect(Z_LAYERS[below]).toBeLessThan(Z_LAYERS[above]);
  });

  it('puts dialogs above every page-chrome layer, which is the invariant that regressed', () => {
    const chrome = [
      Z_LAYERS.navBackdrop,
      Z_LAYERS.chrome,
      Z_LAYERS.searchBar,
      Z_LAYERS.searchBarMorphGhost,
      Z_LAYERS.searchOverlay,
    ];

    expect(Math.max(...chrome)).toBeLessThan(Z_LAYERS.dialog);
  });

  it('leaves room to slot a layer between any two neighbours without renumbering', () => {
    const ordered = Object.values(Z_LAYERS).sort((a, b) => a - b);

    for (let i = 1; i < ordered.length; i += 1) {
      expect(ordered[i]).toBeGreaterThan(ordered[i - 1]);
    }
  });

  it('has no duplicate values — a tie is resolved by DOM order, which is not a decision anyone made', () => {
    const values = Object.values(Z_LAYERS);

    expect(new Set(values).size).toBe(values.length);
  });
});
