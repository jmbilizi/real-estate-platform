import { NextRequest, NextResponse } from 'next/server';
import { fetchGatewayAsUser } from '@/app/api/_lib/authed-gateway';

/** The gateway namespace of the staff API. The service serves `/staff/*`. Ocelot rewrites. */
export const STAFF_API = '/property/staff';

/**
 * Calls the staff API as the signed-in user and returns the upstream status and body.
 * The service enforces the roles. This route only carries the call.
 * Lead data never caches: every response is `no-store`.
 */
export async function proxyStaff(
  req: NextRequest,
  path: string,
  init: { method: string; body?: unknown },
): Promise<NextResponse> {
  const upstream = await fetchGatewayAsUser(req, path, init);
  const body = await upstream.json().catch(() => null);
  return NextResponse.json(
    body ?? { error: { code: 'internal_error', message: 'The service is unavailable.' } },
    { status: upstream.status, headers: { 'Cache-Control': 'no-store' } },
  );
}

export function invalidRequest(): NextResponse {
  return NextResponse.json(
    { error: { code: 'invalid_request', message: 'Invalid request body.' } },
    { status: 400, headers: { 'Cache-Control': 'no-store' } },
  );
}
