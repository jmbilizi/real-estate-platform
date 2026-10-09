import { NextResponse } from 'next/server';
import { fetchGateway } from '@/app/api/_lib/gateway';
import { isIP } from 'node:net';
import {
  createReadCache,
  lifetimeFrom,
  READ_CACHE_MAX_BODY_CHARS,
} from '@/app/api/_lib/read-cache';
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

export interface ProxyListingsOptions {
  /**
   * #755. Serve and store the read in the short server-side cache (`read-cache.ts`). Only public
   * reads that every visitor repeats opt in. The lifetime is the upstream's `Cache-Control`.
   */
  readonly cache?: boolean;
  /** The visitor's IP, so the gateway rate limit counts the visitor, not this pod (#755). */
  readonly clientIp?: string | null;
}

/** One finished upstream read, as plain data: a `NextResponse` body can be read only once. */
interface ProxiedRead {
  readonly status: number;
  readonly body: unknown;
  readonly headers: Readonly<Record<string, string>>;
  /** Lifetime the upstream allowed. Zero for an error or an uncacheable response. */
  readonly sharedSeconds: number;
  readonly browserSeconds: number;
}

/** The gateway answers within its own 3 to 5 s limit. This bounds a hung connection. */
const READ_TIMEOUT_MS = 8_000;

/**
 * One retry after a gateway 502, 503 or 504 or a network failure (#755). A GET is safe to repeat.
 * Only a failure that came back fast is repeated: a pod that was just replaced, or a dropped
 * connection. A failure that took longer is a timeout or an open circuit breaker, and a second
 * request would only add load to a service that is already slow.
 */
const RETRY_STATUSES = new Set([502, 503, 504]);
export const RETRY_DELAY_MS = 300;
const RETRY_ONLY_IF_FASTER_THAN_MS = 1_500;

/** Shared by every request this server handles. */
const listingsReadCache = createReadCache();

/** Test seam: drops every stored read. */
export function clearListingsReadCache(): void {
  listingsReadCache.clear();
}

/**
 * The visitor IP the ingress recorded, or `null`. Only an IPv4 or IPv6 literal passes: the value
 * becomes a header on the next hop.
 */
export function clientIpOf(headers: Headers): string | null {
  const first = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return first && isIP(first) !== 0 ? first : null;
}

/**
 * A deploy rolls this app and the Property API at the same time. For a short window the new web
 * pod sends `skipTotal` to an API that predates it, and the strict request schema answers 400 with
 * "Unknown query parameter(s): skipTotal". The read then repeats once without the parameter, so a
 * row loads with an exact count instead of failing. No other 400 repeats.
 */
const UNKNOWN_SKIP_TOTAL = /Unknown query parameter\(s\):[^.]*\bskipTotal\b/;

function rejectsSkipTotal(read: ProxiedRead): boolean {
  return read.status === 400 && UNKNOWN_SKIP_TOTAL.test(JSON.stringify(read.body));
}

function withoutSkipTotal(query: string): string {
  const params = new URLSearchParams(query);
  params.delete('skipTotal');
  return params.toString();
}

async function readUpstream(
  path: string,
  query: string,
  clientIp: string | null,
): Promise<ProxiedRead> {
  const first = await readUpstreamOnce(path, query, clientIp);
  if (rejectsSkipTotal(first)) {
    return readUpstreamOnce(path, withoutSkipTotal(query), clientIp);
  }
  return first;
}

async function readUpstreamOnce(
  path: string,
  query: string,
  clientIp: string | null,
): Promise<ProxiedRead> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  // The gateway trusts `X-Forwarded-For` from a peer inside the pod network, and keys its rate
  // limits on the address that results.
  if (clientIp) headers['X-Forwarded-For'] = clientIp;
  const target = `${PROPERTY_LISTINGS}${path}${query ? `?${query}` : ''}`;

  let upstream: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const began = Date.now();
    upstream = await fetchGateway(target, { method: 'GET', headers }, READ_TIMEOUT_MS).catch(
      () => null,
    );
    if (upstream && !RETRY_STATUSES.has(upstream.status)) break;
    if (Date.now() - began >= RETRY_ONLY_IF_FASTER_THAN_MS) break;
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }

  if (!upstream) {
    return {
      status: 503,
      body: errorBody('internal_error', 'The listings service is unavailable. Please try again.'),
      headers: {},
      sharedSeconds: 0,
      browserSeconds: 0,
    };
  }

  const body = await upstream.json().catch(() => null);

  if (!upstream.ok) {
    const passthrough = isKnownErrorBody(body)
      ? body
      : errorBody('internal_error', 'The listings service returned an unexpected response.');
    return {
      status: upstream.status,
      body: passthrough,
      headers: {},
      sharedSeconds: 0,
      browserSeconds: 0,
    };
  }

  if (body === null) {
    return {
      status: 502,
      body: errorBody('internal_error', 'The listings service returned an unreadable response.'),
      headers: {},
      sharedSeconds: 0,
      browserSeconds: 0,
    };
  }

  const forwarded: Record<string, string> = {};
  for (const header of CACHE_HEADERS) {
    const value = upstream.headers.get(header);
    if (value) forwarded[header] = value;
  }
  const lifetime = lifetimeFrom(upstream.headers.get('cache-control'));
  return {
    status: upstream.status,
    body,
    headers: forwarded,
    sharedSeconds: lifetime.sharedSeconds,
    browserSeconds: lifetime.browserSeconds,
  };
}

function toResponse(read: ProxiedRead): NextResponse {
  const response = NextResponse.json(read.body, { status: read.status });
  for (const [name, value] of Object.entries(read.headers)) {
    response.headers.set(name, value);
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
 *
 * With `options.cache`, a stored read answers the request, and the browser lifetime shrinks to the
 * time the entry has left. A read is never older than the upstream's own `Cache-Control` allows.
 */
export async function proxyListingsRead(
  path: string,
  query = '',
  options: ProxyListingsOptions = {},
): Promise<NextResponse> {
  const clientIp = options.clientIp ?? null;
  if (!options.cache) {
    return toResponse(await readUpstream(path, query, clientIp));
  }

  const key = `${path}?${query}`;
  const hit = listingsReadCache.get(key);
  if (hit) {
    const maxAge = Math.min(hit.read.browserMaxAgeSeconds, hit.remainingSeconds);
    return NextResponse.json(hit.read.body, {
      headers: { 'cache-control': `public, max-age=${maxAge}` },
    });
  }

  const read = await listingsReadCache.load(key, async (): Promise<ProxiedRead> => {
    const fetched = await readUpstream(path, query, clientIp);
    if (fetched.status !== 200 || fetched.sharedSeconds <= 0) return fetched;

    if (JSON.stringify(fetched.body).length <= READ_CACHE_MAX_BODY_CHARS) {
      listingsReadCache.set(
        key,
        { body: fetched.body, browserMaxAgeSeconds: fetched.browserSeconds },
        fetched.sharedSeconds,
      );
    }
    // A miss and a hit answer with the same headers. `s-maxage` and the validators stay behind,
    // so a cache downstream of this server holds the read for the browser lifetime at most.
    return {
      ...fetched,
      headers: { 'cache-control': `public, max-age=${fetched.browserSeconds}` },
    };
  });
  return toResponse(read);
}
