import type { BuiltUrl } from './nominatim';
import { BRAND } from '@/lib/brand';
import { createNominatimGate } from './nominatim-gate';
import { createReadCache, READ_CACHE_MAX_BODY_CHARS } from './read-cache';

/**
 * The one way this app talks to Nominatim.
 *
 * Both route handlers are the same request with a different URL, so the identifying `User-Agent`
 * the usage policy requires, the timeout, the caching and the soft-failure shape are decided here
 * once instead of twice.
 */

/**
 * Geocoding is a fast lookup; if it has not answered in this long it is not going to be useful to a
 * user waiting on a map. Shorter than the Property API's 30s deliberately — this request is not on
 * the path to any content, and a slow one must not hold a serverless invocation open.
 *
 * `/api/overpass` now bounds itself the same way, off its own declared query budget — see the
 * timeout constants there.
 */
const NOMINATIM_TIMEOUT_MS = 10_000;

/**
 * How long a geocode may be reused.
 *
 * A city's centre and boundary do not move, so this is bounded by our appetite for stale data
 * rather than by correctness, and the usage policy explicitly asks that clients cache instead of
 * refetching. It is set on **our** response as `Cache-Control` rather than pursued with
 * `If-None-Match`: `listings-gateway` already established that undici will not produce a 304 from a
 * conditional request here, so a validator-based scheme buys a round trip and no bytes.
 *
 * The boundary payload is the one worth caching — 5-15KB, and it was refetched on every search.
 */
const CACHE_SECONDS = 86_400;

/**
 * Policy compliance (#781): at most 1 upstream request per second, a cache, an identifying
 * User-Agent. Where autocomplete does not reach here: see `lib/where-suggest.ts`.
 */
const defaultGate = createNominatimGate();
const cache = createReadCache();

/** Test seam: drops stored answers. */
export function clearNominatimCache(): void {
  cache.clear();
}

export async function proxyNominatim(
  built: BuiltUrl,
  label: string,
  gate: { acquire: () => Promise<boolean> } = defaultGate,
): Promise<Response> {
  if (!built.ok) {
    return Response.json({ error: built.error }, { status: 400 });
  }

  const hit = cache.get(built.url);
  if (hit) {
    return Response.json(hit.read.body, {
      headers: { 'Cache-Control': `public, max-age=${hit.remainingSeconds}` },
    });
  }

  // Concurrent misses for one URL share one upstream call and one slot of the budget.
  const shared = await cache.load(built.url, () => fetchUpstream(built.url, label, gate));
  return shared.clone();
}

async function fetchUpstream(
  url: string,
  label: string,
  gate: { acquire: () => Promise<boolean> },
): Promise<Response> {
  if (!(await gate.acquire())) {
    return softFailure(label, 'rate limit: queue full', 429);
  }

  try {
    const upstream = await fetch(url, {
      headers: {
        /*
         * The policy's requirement, and the thing a browser physically cannot do — see `nominatim`.
         *
         * The domain comes from `lib/brand`, which owns it: a hardcoded copy is one more place to
         * miss on a rename, and the identity we present to an upstream whose terms require
         * identification is a poor place to be out of date.
         */
        'User-Agent': `real-estate-platform/1.0 (https://${BRAND.siteDomain.toLowerCase()})`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(NOMINATIM_TIMEOUT_MS),
      next: { revalidate: CACHE_SECONDS },
    });

    if (!upstream.ok) {
      return softFailure(label, `upstream ${upstream.status}`);
    }

    const body = await upstream.json();
    // A boundary polygon can be large. An oversize body is served but not stored.
    if (JSON.stringify(body).length <= READ_CACHE_MAX_BODY_CHARS) {
      cache.set(url, { body, browserMaxAgeSeconds: CACHE_SECONDS }, CACHE_SECONDS);
    }
    return Response.json(body, {
      headers: { 'Cache-Control': `public, max-age=${CACHE_SECONDS}` },
    });
  } catch (e) {
    return softFailure(label, e);
  }
}

/**
 * A failed geocode degrades the map; it must never break the page.
 *
 * Every caller treats a non-array/absent result as "no centre, no boundary" and carries on — the
 * map simply stays where it was. So this answers in the shape they already handle rather than
 * throwing, matching `/api/zcta` and `/api/overpass`. It is deliberately **not** cached: a
 * transient upstream failure must not be reused for a day.
 */
function softFailure(label: string, cause: unknown, status = 502): Response {
  console.error(`[Nominatim] ${label} failed`, cause);
  return Response.json({ error: 'Upstream unavailable' }, { status });
}
