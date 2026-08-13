import { NextResponse } from 'next/server';
import { fetchGateway } from '@/app/api/_lib/gateway';

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
 * Proxies a Property API read through the gateway.
 *
 * Upstream status and body are passed through unchanged so the client can tell a bad request
 * (a 400 the user can act on) from a service that is down (a 502/503 it cannot) — the difference
 * between a useful error state and a blank page.
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
    const passthrough =
      body && typeof body === 'object' && 'error' in body
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

  return NextResponse.json(body);
}
