import { NextRequest } from 'next/server';
import {
  buildNearbyPlacesQuery,
  classifyUpstreamFailure,
  overpassRemark,
  QUERY_TIMEOUT_SECONDS,
} from '../_lib/overpass';

// Proxies OpenStreetMap Overpass API requests for nearby place lookups.
// Overpass does not reliably emit CORS headers so it cannot be called directly from the browser.
//
// What we ask for lives in `_lib/overpass.ts`; this file is only how we ask.
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

/**
 * How long Overpass may sit on the request *before* it starts running it.
 *
 * `[timeout:N]` in the query is an **execution** budget, and execution does not begin when the
 * request arrives — overpass-api.de allows only a couple of concurrent slots per client IP and
 * holds the connection open in a queue until one frees up. So the wall clock a client must budget
 * for is queue + execution, not execution plus a little transfer.
 *
 * Getting this wrong inverts the whole point of the margin: at `[timeout:10] + 2s` our own signal
 * fired first on any loaded upstream, aborting queries that were about to run and turning every
 * lookup into a 502 — exactly the "ours cutting off a query that was about to answer" outcome the
 * margin exists to prevent.
 *
 * Eight seconds is a judgement call, not a measurement, and it cannot be made correct: the queue is
 * someone else's and is unbounded in principle. It is chosen to make *our* timeout the unusual case
 * and Overpass's own `remark` the usual one, because that is the failure we can read and log.
 * Affordable because this lookup is enrichment — it degrades suggestions and never blocks a page.
 */
const QUEUE_ALLOWANCE_MS = 8_000;

/**
 * The timeout that actually bounds this handler.
 *
 * There was no client timeout here at all, only the server-side one inside the query — which does
 * nothing for a connection reset before Overpass ever sees it. `_lib/nominatim-fetch.ts` has had
 * one since it was written and its comment recorded this route's lack of one as outstanding debt.
 */
const REQUEST_TIMEOUT_MS = QUERY_TIMEOUT_SECONDS * 1000 + QUEUE_ALLOWANCE_MS;

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
      /*
       * Composed, not just a timeout: the caller aborts its own request on every re-trigger (the
       * search bar does this on each keystroke), and without `req.signal` in here an abandoned
       * lookup still occupies one of the ~2 Overpass slots our IP gets, for the full budget above.
       * Rapid panning would then park abandoned queries in the exact scarce resource this whole
       * change is about not squandering.
       */
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
    });

    if (!upstream.ok) {
      return softFailure(`upstream ${upstream.status}`);
    }

    const body = await upstream.json();

    /*
     * A 200 is not a success here — see `overpassRemark`. Checked before the response is built,
     * because the thing that makes this failure expensive is the `Cache-Control` below it.
     */
    const remark = overpassRemark(body);

    if (remark) {
      return softFailure(`upstream returned 200 with remark: ${remark}`);
    }

    return Response.json(body, {
      headers: { 'Cache-Control': `public, max-age=${CACHE_SECONDS}` },
    });
  } catch (e) {
    /*
     * `req.signal.aborted` is read here, at the point of failure, rather than passed down from
     * anywhere earlier: it is only meaningful once the request has actually ended.
     */
    return abandonedOrFailed(e, req.signal.aborted);
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

/**
 * The thrown-request path — the only one where "no answer" might not mean "something went wrong".
 *
 * `AbortSignal.any` folds a withdrawn client request and an expired budget into one rejection, and
 * reporting them alike is what makes the log useless. `CompactSearchBar` aborts the in-flight
 * nearby lookup at the top of every re-trigger, so before this split ordinary typing and panning
 * emitted an upstream-error line per abandoned request.
 *
 * That is the exact mirror of the 200-with-remark bug fixed earlier in this PR: there, a real
 * failure logged nothing; here, a non-failure logged loudly. Both leave the same operator equally
 * unable to tell whether anything is actually wrong — which #84 depends on being able to do.
 */
function abandonedOrFailed(cause: unknown, clientAborted: boolean): Response {
  switch (classifyUpstreamFailure(cause, clientAborted)) {
    case 'client-abort':
      /*
       * Silent, and not a 502. Nothing failed, and there is nobody to tell: the caller's own fetch
       * rejected with its own `AbortError` before it could read any of this. 499 ("client closed
       * request") is nginx's convention rather than an RFC status, chosen because it is what shows
       * up in access logs as *not our problem* — the body is omitted for the same reason.
       */
      return new Response(null, { status: 499 });

    case 'timeout':
      // Distinct from a transport failure on purpose: this one says our own budget was the limit,
      // which is the line that matters when tuning `QUEUE_ALLOWANCE_MS` or reading #84's counters.
      console.error(`[Overpass] No response within ${REQUEST_TIMEOUT_MS}ms (queue + query budget)`);
      return Response.json({ error: 'Upstream unavailable' }, { status: 502 });

    default:
      return softFailure(cause);
  }
}
