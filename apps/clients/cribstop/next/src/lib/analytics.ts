import type { AnalyticsEventName, AnalyticsSurface } from '@cribstop/property-contracts';
import { getAnonId } from './anon-id';
import { isPersonalisationEnabled } from './feed-profile';

/**
 * Funnel events (#725, #825). Each call posts to this app's `/api/events` and never throws.
 *
 * The session id is a random code in module memory, so a new tab makes a new one. It resets after
 * 30 minutes with no event. The anonymous id lives in localStorage (`anon-id.ts`). Opt-out and
 * Global Privacy Control delete it and stop every send. The post omits credentials, so the browser
 * sends no cookie. The call carries no account and no free text.
 *
 * Adopt this from a component with `trackEvent(...)`.
 */

export const SESSION_IDLE_MS = 30 * 60 * 1000;

let sessionId: string | null = null;
let lastActivityAt = 0;

function randomSessionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function getAnalyticsSessionId(now: number = Date.now()): string {
  if (sessionId === null || now - lastActivityAt > SESSION_IDLE_MS) sessionId = randomSessionId();
  lastActivityAt = now;
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
    // Global Privacy Control or the footer switch: `getAnonId` deletes the id and returns null.
    // No id also means blocked storage. Send nothing in both cases.
    const anonId = getAnonId();
    if (!anonId || !isPersonalisationEnabled()) return;
    const surface = options.surface ?? surfaceFromPath(window.location.pathname);
    void fetch('/api/events', {
      method: 'POST',
      keepalive: true,
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event,
        surface,
        session_id: getAnalyticsSessionId(),
        anon_id: anonId,
        ...(options.listingId ? { listing_id: options.listingId } : {}),
      }),
    }).catch(() => undefined);
  } catch {
    // A failed event must never affect the page.
  }
}
