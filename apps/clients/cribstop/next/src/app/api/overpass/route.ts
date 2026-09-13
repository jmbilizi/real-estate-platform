import { NextRequest } from 'next/server';
import { buildNearbyPlacesQuery, QUERY_TIMEOUT_SECONDS } from '../_lib/overpass';

// Proxies OpenStreetMap Overpass API requests for nearby place lookups.
// Overpass does not reliably emit CORS headers so it cannot be called directly from the browser.
//
// What we ask for lives in `_lib/overpass.ts`; this file is only how we ask.
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

/**
 * The timeout that actually bounds this handler.
 *
 * Deliberately longer than the query's own `[timeout:...]`: if Overpass is merely slow we want
 * *its* budget to expire and return a real error we can log, not ours to cut off a query that was
 * about to answer. The margin covers connection setup and transfer either side of that budget.
 *
 * There was no client timeout here at all, only the server-side one inside the query — which does
 * nothing for a connection reset before Overpass ever sees it. `_lib/nominatim-fetch.ts` has had
 * one since it was written and its comment recorded this route's lack of one as outstanding debt.
 */
const REQUEST_TIMEOUT_MS = (QUERY_TIMEOUT_SECONDS + 2) * 1000;

/**
 * How long a nearby-places answer may be reused.
 *
 * Towns do not move, so this is bounded by appetite for staleness rather than by correctness, and
 * Overpass's usage policy explicitly asks clients to cache rather than refetch. Matches the day
 * `_lib/nominatim-fetch.ts` uses, for the same reason.
 *
 * It is set as `Cache-Control` on *our* response rather than via `next: { revalidate }` on the
 * upstream call, because that would do nothing here: Next's Data Cache does not cache `fetch`
 * requests made with `POST`, and Overpass requires POST.
 */
const CACHE_SECONDS = 86_400;

export async function GET(req: NextRequest) {
  const built = buildNearbyPlacesQuery(req.nextUrl.searchParams);

  if (!built.ok) {
    return Response.json({ error: built.error }, { status: 400 });
  }

  try {
    const upstream = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'real-estate-platform/1.0',
      },
      body: `data=${encodeURIComponent(built.query)}`,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!upstream.ok) {
      return softFailure(`upstream ${upstream.status}`);
    }

    return Response.json(await upstream.json(), {
      headers: { 'Cache-Control': `public, max-age=${CACHE_SECONDS}` },
    });
  } catch (e) {
    return softFailure(e);
  }
}

/**
 * A failed lookup degrades the suggestions; it must never break the page.
 *
 * `fetchNearbyLocationsByType` in `lib/search-utils.tsx` already treats any non-OK response as "no
 * nearby places" and carries on, so this answers in the shape that caller handles rather than
 * throwing — the same contract as `/api/geocode` and `/api/zcta`.
 *
 * Carries no `Cache-Control` on purpose: a transient upstream failure must not be served for a day.
 */
function softFailure(cause: unknown): Response {
  console.error('[Overpass] Upstream request failed', cause);
  return Response.json({ error: 'Upstream unavailable' }, { status: 502 });
}
