import { NextResponse } from 'next/server';
import { fetchGateway } from '@/app/api/_lib/gateway';
import { isGatewayErrorBody } from '@cribstop/gateway-contracts';
import { errorBodySchema } from '@cribstop/property-contracts';

/**
 * Every service is namespaced at the gateway by its domain. The base URL already supplies the
 * gateway itself, so there is no `/gateway` segment, and the service's own `/listings/*` path is
 * an implementation detail behind Ocelot's rewrite — never call it directly.
 */
const PROPERTY_LISTINGS = '/property/listings';

/** The contract's error body, so the client has exactly one error shape to render against. */
function errorBody(code: 'invalid_request' | 'not_found' | 'internal_error', message: string) {
  return { error: { code, message } };
}

/**
 * True when `body` is a known error shape worth forwarding as-is: the Property API's own contract,
 * or the gateway's own 429/502/503 envelope (#177). Anything else — a stray HTML error page, an
 * empty object — is replaced with the local `internal_error` fallback instead of being forwarded
 * unchecked.
 */
function isKnownErrorBody(body: unknown): boolean {
  return errorBodySchema.safeParse(body).success || isGatewayErrorBody(body);
}

/**
 * The caching headers the Property API sets, forwarded verbatim.
 *
 * The service already answers these reads with `Cache-Control: public, max-age=60` and a weak
 * `ETag`, and this proxy used to drop both — it re-serialized the body through `NextResponse.json`
 * and sent nothing else, so the browser was told nothing about freshness and could not reuse a
 * response it had just received. Every remount of a results grid was a full round trip for bytes
 * already in memory.
 *
 * Forwarded rather than invented here, deliberately. The 60 seconds is the service's judgement
 * about its own data — it is what `listing_search_v` and seller display-suppression can safely
 * tolerate — and this hop is not the place to second-guess it.
 */
const CACHE_HEADERS = ['cache-control', 'etag', 'last-modified'] as const;

function withCacheHeaders(response: NextResponse, upstream: Response): NextResponse {
  for (const header of CACHE_HEADERS) {
    const value = upstream.headers.get(header);
    if (value) response.headers.set(header, value);
  }
  return response;
}

/**
 * Proxies a Property API read through the gateway.
 *
 * Upstream status and body are passed through unchanged. This lets the client tell three cases
 * apart: a bad request (400, the user can fix it), a downed service (502/503, the user cannot fix
 * it), and a rate limit (429, the user can act on it by waiting). See
 * `@cribstop/gateway-contracts` for the gateway's own 429/502/503 envelope.
 *
 * **Conditional requests are deliberately not forwarded**, and it is worth knowing why before
 * adding them. The gateway honours `If-None-Match` correctly — curl gets a 304 from it — but
 * Node's `fetch` does not: the identical request through undici comes back 200 with a full body,
 * reproducible with a bare script and no Next.js involved. Plumbing the header through therefore
 * looks like revalidation while silently transferring the whole payload every time, which is worse
 * than not having it. `max-age` is what does the work here anyway; a revalidation only matters once
 * the response is already stale.
 */
export async function proxyListingsRead(path: string, query = ''): Promise<NextResponse> {
  const upstream = await fetchGateway(`${PROPERTY_LISTINGS}${path}${query ? `?${query}` : ''}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  }).catch(() => null);

  if (!upstream) {
    return NextResponse.json(
      errorBody('internal_error', 'The listings service is unavailable. Please try again.'),
      { status: 503 },
    );
  }

  const body = await upstream.json().catch(() => null);

  if (!upstream.ok) {
    const passthrough = isKnownErrorBody(body)
      ? body
      : errorBody('internal_error', 'The listings service returned an unexpected response.');
    return NextResponse.json(passthrough, { status: upstream.status });
  }

  if (body === null) {
    return NextResponse.json(
      errorBody('internal_error', 'The listings service returned an unreadable response.'),
      { status: 502 },
    );
  }

  return withCacheHeaders(NextResponse.json(body), upstream);
}
