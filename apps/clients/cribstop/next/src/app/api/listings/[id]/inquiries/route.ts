import { NextRequest, NextResponse } from 'next/server';
import { fetchGateway } from '@/app/api/_lib/gateway';
import { AUTH_COOKIES } from '@/app/api/_lib/cookies';
import { inquiryKindSchema } from '@cribstop/property-contracts';

/**
 * Forwards a buyer-agent request (#132) to `POST /property/listings/{id}/inquiries`.
 *
 * The body is rebuilt from an allowlist. `consentToContact` is never forwarded: every request is
 * already a request for Cribstop as the buyer agent, and the service defaults it to false.
 * The access token, when present, lets the service link the inquiry to the account. A missing or
 * expired token is not an error: the service treats the request as signed-out.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const input = await req.json().catch(() => null);
  const kind = inquiryKindSchema.safeParse(input?.kind);
  const isText = (v: unknown) => v === undefined || typeof v === 'string';
  if (
    !input ||
    typeof input !== 'object' ||
    !kind.success ||
    typeof input.name !== 'string' ||
    typeof input.email !== 'string' ||
    !isText(input.phone) ||
    !isText(input.message)
  ) {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: 'Invalid request body.' } },
      { status: 400 },
    );
  }

  const payload: Record<string, unknown> = {
    kind: kind.data,
    name: input.name,
    email: input.email,
  };
  if (input.phone) payload.phone = input.phone;
  if (input.message) payload.message = input.message;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  const token = req.cookies.get(AUTH_COOKIES.accessToken)?.value;
  if (token) headers.Authorization = `Bearer ${token}`;

  const upstream = await fetchGateway(`/property/listings/${encodeURIComponent(id)}/inquiries`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  }).catch(() => null);

  if (!upstream) {
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'The service is unavailable.' } },
      { status: 503 },
    );
  }

  const body = await upstream.json().catch(() => null);
  if (!upstream.ok) {
    const code = typeof body?.error?.code === 'string' ? body.error.code : 'internal_error';
    return NextResponse.json(
      { error: { code, message: 'The request could not be sent.' } },
      { status: upstream.status },
    );
  }
  return NextResponse.json(body ?? {}, { status: upstream.status });
}
