import type { AnalyticsEventName, AnalyticsSurface } from '@cribstop/property-contracts';
import { getAnonId, isNewAnonId } from './anon-id';
import { isPersonalisationEnabled, PERSONALISE_EVENT } from './feed-profile';

/**
 * Funnel events (#725, #825, #826). Every event goes through `trackEvent`, which never throws and
 * never blocks rendering.
 *
 * Sending: impressions wait in a queue. The queue flushes every 5 seconds, at 50 events, when the
 * page hides, and with the next event of any other kind. One flush is one array body, so the
 * gateway limit of 120 requests per minute is never the limit. The post uses `keepalive`, so it
 * survives a page unload. It omits credentials, so the browser sends no cookie.
 *
 * Identity: the session id is a random code in module memory. It resets after 30 minutes with no
 * event. The anonymous id lives in localStorage (`anon-id.ts`). Opt-out and Global Privacy Control
 * delete it, empty the queue and stop every send.
 *
 * Adopt this from a component with `trackEvent(...)`.
 */

export const SESSION_IDLE_MS = 30 * 60 * 1000;
export const FLUSH_INTERVAL_MS = 5_000;
export const BATCH_MAX = 50;
const BATCHED_EVENTS: ReadonlySet<AnalyticsEventName> = new Set([
  'listing_impression',
  'feed_impression',
]);

let sessionId: string | null = null;
let lastActivityAt = 0;
let sessionIsNew = false;

function randomSessionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function getAnalyticsSessionId(now: number = Date.now()): string {
  if (sessionId === null || now - lastActivityAt > SESSION_IDLE_MS) {
    sessionId = randomSessionId();
    sessionIsNew = true;
  }
  lastActivityAt = now;
  return sessionId;
}

/** The page area for a path, when the caller does not know it. */
export function surfaceFromPath(pathname: string): AnalyticsSurface {
  if (pathname.startsWith('/favorites')) return 'favorites';
  if (pathname.startsWith('/listing') || pathname.startsWith('/property')) return 'detail';
  if (pathname === '/') return 'home';
  if (/^\/(login|signup|forgot-password|secure-account)/.test(pathname)) return 'auth';
  return 'search';
}

/** A path with every id and place name replaced, so no event carries a value a visitor typed. */
export function pathTemplate(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);
  const [first, second] = segments;
  if (!first) return '/';
  if (first === 'listing') return '/listing/[id]';
  if (first === 'property') return '/property/[slug]/[id]';
  if (first === 'admin' || first === 'agent') {
    return segments.length > 2
      ? `/${first}/leads/[id]`
      : `/${first}/${second === 'agents' ? 'agents' : 'leads'}`;
  }
  const STATIC = [
    'about',
    'accessibility',
    'account',
    'business',
    'fair-housing',
    'favorites',
    'list',
    'privacy',
    'terms',
    'connect',
    'services',
    'homes-for-rent',
    'homes-for-sale',
    'neighborhoods',
    'search',
    'login',
    'signup',
    'forgot-password',
    'secure-account',
  ];
  return STATIC.includes(first) ? `/${first}` : '/[city]/[...rest]';
}

function deviceOf(): 'mobile' | 'tablet' | 'desktop' {
  const w = window.innerWidth;
  return w < 640 ? 'mobile' : w < 1024 ? 'tablet' : 'desktop';
}

/** Campaign tags and the referring host, read once per page load. */
let landing: Record<string, string> | null = null;
function landingProps(): Record<string, string> {
  if (landing) return landing;
  landing = {};
  try {
    const params = new URLSearchParams(window.location.search);
    for (const name of ['utm_source', 'utm_medium', 'utm_campaign']) {
      const v = (params.get(name) ?? '').toLowerCase();
      if (/^[a-z0-9_.-]{1,64}$/.test(v)) landing[name] = v;
    }
    const host = document.referrer ? new URL(document.referrer).hostname.toLowerCase() : '';
    if (host && host !== window.location.hostname && /^[a-z0-9][a-z0-9.-]{0,98}$/.test(host)) {
      landing['referrer_host'] = host;
    }
  } catch {
    // A bad URL gives no campaign data.
  }
  return landing;
}

export interface TrackOptions {
  surface?: AnalyticsSurface;
  listingId?: string;
  /** Event properties from the contract (`EVENT_PROPS`). The server rejects any other. */
  props?: Record<string, unknown>;
}

type QueuedEvent = Record<string, unknown>;
let queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let listening = false;

function dropQueue(): void {
  queue = [];
  if (timer) clearTimeout(timer);
  timer = null;
}

/** Sends the queue now, in arrays of at most 50. Sends nothing after an opt-out. */
export function flushEvents(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  try {
    if (queue.length === 0) return;
    if (!getAnonId() || !isPersonalisationEnabled()) {
      dropQueue();
      return;
    }
    const batches: QueuedEvent[][] = [];
    for (let i = 0; i < queue.length; i += BATCH_MAX) batches.push(queue.slice(i, i + BATCH_MAX));
    queue = [];
    for (const body of batches) {
      void fetch('/api/events', {
        method: 'POST',
        keepalive: true,
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).catch(() => undefined);
    }
  } catch {
    // A failed event must never affect the page.
  }
}

function listen(): void {
  if (listening) return;
  listening = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushEvents();
  });
  window.addEventListener('pagehide', flushEvents);
  window.addEventListener(PERSONALISE_EVENT, () => {
    if (!isPersonalisationEnabled()) dropQueue();
  });
}

function build(event: AnalyticsEventName, options: TrackOptions, anonId: string): QueuedEvent {
  return {
    event,
    surface: options.surface ?? surfaceFromPath(window.location.pathname),
    session_id: getAnalyticsSessionId(),
    anon_id: anonId,
    path_template: pathTemplate(window.location.pathname),
    device: deviceOf(),
    ...landingProps(),
    ...(options.listingId ? { listing_id: options.listingId } : {}),
    ...options.props,
  };
}

export function trackEvent(event: AnalyticsEventName, options: TrackOptions = {}): void {
  try {
    if (typeof window === 'undefined' || typeof fetch !== 'function') return;
    // Global Privacy Control or the footer switch: `getAnonId` deletes the id and returns null.
    // No id also means blocked storage. Send nothing in both cases.
    const anonId = getAnonId();
    if (!anonId || !isPersonalisationEnabled()) {
      dropQueue();
      return;
    }
    listen();
    getAnalyticsSessionId();
    if (sessionIsNew && event !== 'session_start') {
      sessionIsNew = false;
      queue.push(
        build(
          'session_start',
          {
            surface: options.surface,
            props: {
              landing_path: pathTemplate(window.location.pathname),
              is_new_anon: isNewAnonId(),
            },
          },
          anonId,
        ),
      );
    }
    if (event === 'session_start') sessionIsNew = false;
    queue.push(build(event, options, anonId));
    if (!BATCHED_EVENTS.has(event) || queue.length >= BATCH_MAX) flushEvents();
    else timer ??= setTimeout(flushEvents, FLUSH_INTERVAL_MS);
  } catch {
    // A failed event must never affect the page.
  }
}
