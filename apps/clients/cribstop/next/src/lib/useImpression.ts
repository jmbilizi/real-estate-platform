'use client';

import { useCallback, useEffect, useRef } from 'react';

export const IMPRESSION_VISIBLE_RATIO = 0.5;
export const IMPRESSION_DWELL_MS = 1000;

/** Keys already counted in this page view. A re-render or a remount cannot count one twice. */
const counted = new Set<string>();

/** Call on a route change: a new page view counts its cards again. */
export function resetImpressions(): void {
  counted.clear();
}

/**
 * Calls `onImpression` once per `key` per page view, after the element stays at least 50% visible
 * for 1 second in a visible tab. A null `key` counts nothing. Attach the returned ref to the
 * element. It reads the page and never changes layout.
 */
export function useImpression<T extends Element>(
  key: string | null,
  onImpression: () => void,
): (el: T | null) => void {
  const callback = useRef(onImpression);
  callback.current = onImpression;
  const cleanup = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanup.current?.(), []);

  return useCallback(
    (el: T | null) => {
      cleanup.current?.();
      cleanup.current = null;
      if (!el || !key || typeof IntersectionObserver === 'undefined') return;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const stop = () => {
        if (timer) clearTimeout(timer);
        timer = null;
      };
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting && entry.intersectionRatio >= IMPRESSION_VISIBLE_RATIO) {
              if (timer || counted.has(key)) continue;
              timer = setTimeout(() => {
                timer = null;
                if (document.hidden || counted.has(key)) return;
                counted.add(key);
                observer.disconnect();
                callback.current();
              }, IMPRESSION_DWELL_MS);
            } else {
              stop();
            }
          }
        },
        { threshold: [0, IMPRESSION_VISIBLE_RATIO] },
      );
      observer.observe(el);
      cleanup.current = () => {
        stop();
        observer.disconnect();
      };
    },
    [key],
  );
}
