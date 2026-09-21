import { NextResponse } from 'next/server';
import { fetchGateway } from '@/app/api/_lib/gateway';

/**
 * Redeems a confirmation link's `userId`/`code` against Identity. Expired, used, tampered and
 * unknown links all answer `401` with the same body (#147); an already-confirmed link answers
 * `200`, same as a first-time success. This route collapses both to a plain outcome so the page
 * never has to parse Identity's HTML confirmation response.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const userId = url.searchParams.get('userId') ?? '';
  const code = url.searchParams.get('code') ?? '';

  if (!userId || !code) {
    return NextResponse.json({ outcome: 'invalid' }, { status: 400 });
  }

  const params = new URLSearchParams({ userId, code });
  const upstream = await fetchGateway(
    `/account/confirmEmail?${params.toString()}`,
    {
      method: 'GET',
      headers: { Accept: 'application/json' },
    },
    60_000, // .NET cold-start + EF Core pool init can be slow on first request
  ).catch((err: unknown) => {
    console.error('Gateway confirm-email failed', err);
    return null;
  });

  if (!upstream) {
    return NextResponse.json({ outcome: 'invalid' }, { status: 503 });
  }

  return NextResponse.json(
    { outcome: upstream.ok ? 'confirmed' : 'invalid' },
    { status: upstream.ok ? 200 : 401 },
  );
}
