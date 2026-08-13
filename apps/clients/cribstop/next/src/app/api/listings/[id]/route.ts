import { NextRequest } from 'next/server';
import { proxyListingsRead } from '@/app/api/_lib/listings-gateway';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxyListingsRead(`/${encodeURIComponent(id)}`);
}
