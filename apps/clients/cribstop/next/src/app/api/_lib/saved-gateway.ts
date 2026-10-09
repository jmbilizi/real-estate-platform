import { NextRequest, NextResponse } from 'next/server';
import { fetchGatewayAsUser } from './authed-gateway';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

function codeForStatus(status: number): string {
  if (status === 401) return 'unauthenticated';
  if (status === 404) return 'not_found';
  if (status === 400) return 'invalid_request';
  if (status === 429) return 'rate_limited';
  if (status === 502 || status === 503) return 'unavailable';
  return 'internal_error';
}

/**
 * Relays one saved-homes call (#23) as the signed-in user. Status passes through. The error body
 * is rebuilt in the contract's `{ error: { code, message } }` shape, because the gateway's own
 * 502/503 body and the 401 of `fetchGatewayAsUser` use other shapes. Nothing is cached.
 */
export async function relaySaved(
  req: NextRequest,
  path: string,
  method: 'GET' | 'PUT' | 'DELETE',
): Promise<NextResponse> {
  const upstream = await fetchGatewayAsUser(req, path, { method });
  const body = await upstream.json().catch(() => null);
  if (!upstream.ok) {
    const upstreamCode = body?.error?.code;
    const code = typeof upstreamCode === 'string' ? upstreamCode : codeForStatus(upstream.status);
    return NextResponse.json(
      { error: { code, message: 'The saved-homes request failed.' } },
      { status: upstream.status, headers: NO_STORE },
    );
  }
  return NextResponse.json(body ?? {}, { status: upstream.status, headers: NO_STORE });
}
