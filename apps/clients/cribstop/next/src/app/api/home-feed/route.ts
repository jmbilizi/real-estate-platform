import { NextRequest, NextResponse } from 'next/server';
import { homeFeedRequestSchema } from '@cribstop/property-contracts';
import { fetchGateway } from '@/app/api/_lib/gateway';

/**
 * Relay for `POST /property/home-feed` (#836). The body carries the visitor's local profile.
 * This handler never logs it and never forwards the IP, the user agent or any cookie. The
 * answer is `no-store`, because a personalised answer must not enter a shared cache.
 */
const NO_STORE = { 'Cache-Control': 'no-store' };
const FEED_TIMEOUT_MS = 4_000;
const MAX_BODY_BYTES = 16_384;

const failure = (status: number) =>
  NextResponse.json(
    { error: { code: status === 400 ? 'invalid_request' : 'internal_error', message: 'No feed.' } },
    { status, headers: NO_STORE },
  );

export async function POST(req: NextRequest) {
  if (req.headers.get('sec-gpc') === '1') return failure(400);
  // A chunked body has no length header, so the size check runs on the text as well.
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return failure(400);
  const text = await req.text().catch(() => '');
  if (text.length > MAX_BODY_BYTES) return failure(400);
  let raw: unknown = null;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = null;
  }
  const parsed = homeFeedRequestSchema.safeParse(raw);
  if (!parsed.success) return failure(400);
  try {
    const res = await fetchGateway(
      '/property/home-feed',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      },
      FEED_TIMEOUT_MS,
    );
    if (!res.ok) return failure(502);
    const body: unknown = await res.json().catch(() => null);
    if (body === null) return failure(502);
    return NextResponse.json(body, { headers: NO_STORE });
  } catch {
    return failure(502);
  }
}
