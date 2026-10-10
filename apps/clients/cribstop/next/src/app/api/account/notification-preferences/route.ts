import { NextRequest, NextResponse } from 'next/server';
import { fetchGatewayAsUser } from '@/app/api/_lib/authed-gateway';

const ITEM_FIELDS = ['channel', 'category', 'enabled', 'consentWordingId'] as const;

export async function GET(req: NextRequest) {
  const upstream = await fetchGatewayAsUser(req, '/account/notification-preferences', {
    method: 'GET',
  });
  if (!upstream.ok) {
    return NextResponse.json({ error: 'Failed to load preferences' }, { status: upstream.status });
  }
  return NextResponse.json(await upstream.json().catch(() => ({})));
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.items)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  // Forward only the known fields. The service validates every value.
  const items = body.items.map((item: Record<string, unknown>) => {
    const forwarded: Record<string, unknown> = {};
    for (const field of ITEM_FIELDS) {
      if (item && field in item) forwarded[field] = item[field];
    }
    return forwarded;
  });

  const upstream = await fetchGatewayAsUser(req, '/account/notification-preferences', {
    method: 'PUT',
    body: { items },
  });
  const payload = await upstream.json().catch(() => ({}));
  return NextResponse.json(payload, { status: upstream.status });
}
