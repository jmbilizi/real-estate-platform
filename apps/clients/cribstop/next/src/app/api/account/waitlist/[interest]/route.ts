import { NextRequest, NextResponse } from 'next/server';
import { fetchGatewayAsUser } from '@/app/api/_lib/authed-gateway';

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ interest: string }> }) {
  const { interest } = await ctx.params;
  const upstream = await fetchGatewayAsUser(
    req,
    `/account/waitlist/${encodeURIComponent(interest)}`,
    { method: 'DELETE' },
  );
  if (!upstream.ok) {
    return NextResponse.json({ error: 'Failed to leave waitlist' }, { status: upstream.status });
  }
  return new NextResponse(null, { status: 204 });
}
