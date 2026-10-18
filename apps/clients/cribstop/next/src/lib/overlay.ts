import { useEffect } from 'react';

/** Set on `<html>` while any overlay is open. `globals.css` hides the phone tab bar on it. */
export const OVERLAY_OPEN_ATTRIBUTE = 'data-overlay-open';

/** Marks a server-rendered overlay, so the first paint matches. The registry takes over on mount. */
export const OVERLAY_MARKER_ATTRIBUTE = 'data-overlay';

let openCount = 0;

function sync() {
  const root = document.documentElement;
  if (openCount > 0) root.setAttribute(OVERLAY_OPEN_ATTRIBUTE, '');
  else root.removeAttribute(OVERLAY_OPEN_ATTRIBUTE);
}

/**
 * Registers a full-screen overlay, sheet or modal panel while `open` is true.
 * Every component that renders a `fixed inset-0` layer must call this.
 * `overlay.spec.ts` fails if one does not.
 */
export function useOverlayOpen(open: boolean) {
  useEffect(() => {
    if (!open) return;
    openCount += 1;
    sync();
    return () => {
      openCount = Math.max(0, openCount - 1);
      sync();
    };
  }, [open]);
}
