import { NextRequest } from 'next/server';
import { proxyStaff, STAFF_API } from '../../_lib/proxy';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxyStaff(req, `${STAFF_API}/leads/${encodeURIComponent(id)}`, { method: 'GET' });
}
