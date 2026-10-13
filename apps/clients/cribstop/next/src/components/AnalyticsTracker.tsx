'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { pathTemplate, surfaceFromPath, trackEvent } from '@/lib/analytics';
import { resetImpressions } from '@/lib/useImpression';

/** Visitor input older than this no longer counts as active time. */
export const ACTIVE_WINDOW_MS = 30_000;
const TICK_MS = 1000;

/**
 * Sends `page_view` on each route and `dwell` when the visitor leaves it (#826). Dwell counts only
 * the seconds when the tab is visible and the visitor gave input in the last 30 seconds.
 * Renders nothing.
 */
export default function AnalyticsTracker() {
  const pathname = usePathname();

  useEffect(() => {
    resetImpressions();
    const surface = surfaceFromPath(pathname);
    const template = pathTemplate(pathname);
    // The route has changed by the time the cleanup runs, so pass the route's own values.
    const own = { surface, props: { path_template: template } } as const;
    trackEvent('page_view', own);

    let activeMs = 0;
    let lastInput = Date.now();
    const onInput = () => {
      lastInput = Date.now();
    };
    const tick = setInterval(() => {
      if (!document.hidden && Date.now() - lastInput <= ACTIVE_WINDOW_MS) activeMs += TICK_MS;
    }, TICK_MS);
    const send = () => {
      if (activeMs >= TICK_MS) {
        trackEvent('dwell', { surface, props: { path_template: template, active_ms: activeMs } });
      }
      activeMs = 0;
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') send();
    };
    const inputs = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const;
    for (const name of inputs) window.addEventListener(name, onInput, { passive: true });
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', send);
    return () => {
      clearInterval(tick);
      for (const name of inputs) window.removeEventListener(name, onInput);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', send);
      send();
    };
  }, [pathname]);

  return null;
}
