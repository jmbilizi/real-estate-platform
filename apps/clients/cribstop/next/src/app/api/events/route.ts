import { NextRequest, NextResponse } from 'next/server';
import { analyticsEventRequestSchema } from '@cribstop/property-contracts';
import { fetchGateway } from '@/app/api/_lib/gateway';
import { clientIpOf } from '@/app/api/_lib/listings-gateway';

/**
 * First-party funnel event endpoint (#725). It sets no cookie and stores nothing itself.
 *
 * It forwards the validated body to the Property API. The visitor IP goes out only as
 * `X-Forwarded-For`, so the gateway rate limit counts the visitor. The Property API never reads
 * it. The user agent, cookies and `Authorization` never leave this handler. A failure upstream
 * answers 204: an event must never show an error to the visitor.
 */
const NO_STORE = { 'Cache-Control': 'no-store' };
const EVENT_TIMEOUT_MS = 3_000;

export async function POST(req: NextRequest) {
  if ((process.env.ANALYTICS_ENABLED ?? 'true').trim().toLowerCase() === 'false') {
    return new NextResponse(null, { status: 204, headers: NO_STORE });
  }
  const raw: unknown = await req.json().catch(() => null);
  const parsed = analyticsEventRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: 'The event is not valid.' } },
      { status: 400, headers: NO_STORE },
    );
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const ip = clientIpOf(req.headers);
  if (ip) headers['X-Forwarded-For'] = ip;
  try {
    await fetchGateway(
      '/property/analytics/events',
      { method: 'POST', headers, body: JSON.stringify(parsed.data) },
      EVENT_TIMEOUT_MS,
    );
  } catch {
    // Fail silently.
  }
  return new NextResponse(null, { status: 204, headers: NO_STORE });
}
