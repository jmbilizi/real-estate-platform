import { NextRequest, NextResponse } from 'next/server';
import { fetchGatewayAsUser } from '@/app/api/_lib/authed-gateway';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ctx = { params: Promise<{ id: string }> };

const FIELDS = [
  'intent',
  'places',
  'priceMin',
  'priceMax',
  'bedsMin',
  'bathsMin',
  'homeTypes',
  'whenStart',
  'whenEnd',
] as const;

export async function PUT(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  if (!GUID.test(id) || !body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  // Forward only the known fields. The service validates every value.
  const forwarded: Record<string, unknown> = {};
  for (const field of FIELDS) {
    if (field in body) forwarded[field] = body[field];
  }

  const upstream = await fetchGatewayAsUser(req, `/account/looking-for/${id}`, {
    method: 'PUT',
    body: forwarded,
  });
  const payload = await upstream.json().catch(() => null);
  if (!upstream.ok) {
    return NextResponse.json(
      {
        error: upstream.status === 409 ? 'limit_reached' : 'Could not save',
        errors: payload?.errors,
      },
      { status: upstream.status },
    );
  }
  return NextResponse.json(payload, { status: upstream.status });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!GUID.test(id)) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const upstream = await fetchGatewayAsUser(req, `/account/looking-for/${id}`, {
    method: 'DELETE',
  });
  if (!upstream.ok) {
    return NextResponse.json({ error: 'Could not delete' }, { status: upstream.status });
  }
  return new NextResponse(null, { status: 204 });
}
