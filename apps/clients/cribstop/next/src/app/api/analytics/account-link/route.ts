import { NextRequest, NextResponse } from 'next/server';
import { analyticsAccountLinkRequestSchema } from '@cribstop/property-contracts';
import { fetchGatewayAsUser } from '@/app/api/_lib/authed-gateway';

/**
 * Links the anonymous id to the signed-in account (#827). The browser calls it once after a
 * verified sign-in. The route forwards the anon id and the session. It never forwards a cookie,
 * the user agent or the IP. Global Privacy Control and `ANALYTICS_ENABLED=false` forward nothing.
 */
const NO_STORE = { 'Cache-Control': 'private, no-store' };

export async function POST(req: NextRequest) {
  const disabled = (process.env.ANALYTICS_ENABLED ?? 'true').trim().toLowerCase() === 'false';
  if (disabled || req.headers.get('sec-gpc') === '1') {
    return new NextResponse(null, { status: 204, headers: NO_STORE });
  }
  const parsed = analyticsAccountLinkRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: 'The request is not valid.' } },
      { status: 400, headers: NO_STORE },
    );
  }
  const upstream = await fetchGatewayAsUser(req, '/property/analytics/account-link', {
    method: 'POST',
    body: parsed.data,
  });
  // The client ignores the answer. Keep the status so a test or a log can tell the cases apart.
  return new NextResponse(null, { status: upstream.ok ? 204 : upstream.status, headers: NO_STORE });
}
