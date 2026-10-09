// Module-level: survives React Strict Mode unmount/remount cycles (unlike useRef)
let scheduledScrollUnlock: ReturnType<typeof setTimeout> | null = null;

/** Cancels an unlock queued by `deferUnlockScroll`. */
export function cancelDeferredUnlock() {
  if (scheduledScrollUnlock !== null) {
    clearTimeout(scheduledScrollUnlock);
    scheduledScrollUnlock = null;
  }
}

/**
 * Locks page scroll on the root element for a modal dialog.
 *
 * The scrollbar gutter stays, so the page keeps its width and does not shift when the dialog opens
 * or closes. `globals.css` applies the same two declarations to a server-rendered panel from its
 * first paint. A padding fallback covers browsers without `scrollbar-gutter`.
 */
export function lockScroll() {
  // Cancel any pending deferred unlock first (handles Strict Mode re-mount)
  cancelDeferredUnlock();
  const root = document.documentElement;
  if (
    typeof CSS !== 'undefined' &&
    typeof CSS.supports === 'function' &&
    CSS.supports('scrollbar-gutter', 'stable')
  ) {
    root.style.scrollbarGutter = 'stable';
  } else if (root.style.overflow !== 'hidden') {
    root.style.paddingRight = `${window.innerWidth - root.clientWidth}px`;
  }
  root.style.overflow = 'hidden';
}

export function unlockScroll() {
  const root = document.documentElement;
  root.style.paddingRight = '';
  root.style.scrollbarGutter = '';
  root.style.overflow = '';
}

/** Unlocks on the next macrotask. A Strict Mode re-mount cancels it through `lockScroll`. */
export function deferUnlockScroll() {
  scheduledScrollUnlock = setTimeout(() => {
    scheduledScrollUnlock = null;
    unlockScroll();
  }, 0);
}
