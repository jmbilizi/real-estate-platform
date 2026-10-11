import type { AnalyticsEventName, AnalyticsSurface } from '@cribstop/property-contracts';

/**
 * Cookieless funnel events (#725). Each call posts to this app's `/api/events` and never throws.
 *
 * The session id is a random code in module memory. A reload or a new tab makes a new one. It is
 * never written to a cookie, localStorage or sessionStorage. The post omits credentials, so the
 * browser sends no cookie. The call carries no search words, no account and no free text.
 *
 * Adopt this from a component with `trackEvent(...)`.
 */

let sessionId: string | null = null;

function randomSessionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function getAnalyticsSessionId(): string {
  sessionId ??= randomSessionId();
  return sessionId;
}

/** The page area for a path, when the caller does not know it. */
export function surfaceFromPath(pathname: string): AnalyticsSurface {
  if (pathname.startsWith('/favorites')) return 'favorites';
  if (pathname.startsWith('/listing') || pathname.startsWith('/property')) return 'detail';
  return 'search';
}

export interface TrackOptions {
  surface?: AnalyticsSurface;
  listingId?: string;
}

export function trackEvent(event: AnalyticsEventName, options: TrackOptions = {}): void {
  try {
    if (typeof window === 'undefined' || typeof fetch !== 'function') return;
    const surface = options.surface ?? surfaceFromPath(window.location.pathname);
    void fetch('/api/events', {
      method: 'POST',
      keepalive: true,
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event,
        surface,
        sessionId: getAnalyticsSessionId(),
        ...(options.listingId ? { listingId: options.listingId } : {}),
      }),
    }).catch(() => undefined);
  } catch {
    // A failed event must never affect the page.
  }
}
