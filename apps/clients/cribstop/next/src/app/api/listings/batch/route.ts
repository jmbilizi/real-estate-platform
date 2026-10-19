import { NextRequest, NextResponse } from 'next/server';
import { listingsBatchRequestSchema } from '@cribstop/property-contracts';
import { FORWARDABLE_LISTING_PARAMS } from '@/app/api/_lib/listings-query';
import { clientIpOf, proxyListingsRead } from '@/app/api/_lib/listings-gateway';

/**
 * Relay for `POST /property/listings/batch` (#960): the home page rows in one gateway request.
 * The body holds public search parameters only. The relay forwards no cookie and no credential,
 * so the answer is non-personal and the shared read cache can hold it.
 */
const MAX_BODY_BYTES = 16_384;

const invalid = () =>
  NextResponse.json(
    { error: { code: 'invalid_request', message: 'Invalid batch request.' } },
    { status: 400 },
  );

export async function POST(req: NextRequest) {
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return invalid();
  const text = await req.text().catch(() => '');
  if (text.length > MAX_BODY_BYTES) return invalid();
  let raw: unknown = null;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = null;
  }
  const parsed = listingsBatchRequestSchema.safeParse(raw);
  if (!parsed.success) return invalid();
  // The same allowlist as `GET /api/listings`: a parameter outside the contract never goes out.
  const allowed = new Set(FORWARDABLE_LISTING_PARAMS);
  const known = parsed.data.rows.every((row) =>
    Object.keys(row.params).every((k) => allowed.has(k)),
  );
  if (!known) return invalid();

  return proxyListingsRead('/batch', '', {
    cache: true,
    clientIp: clientIpOf(req.headers),
    body: JSON.stringify(parsed.data),
  });
}
