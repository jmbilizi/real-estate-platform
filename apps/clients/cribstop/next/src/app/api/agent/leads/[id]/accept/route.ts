import { NextRequest } from 'next/server';
import { AGENT_API, proxyStaff } from '../../../../staff/_lib/proxy';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxyStaff(req, `${AGENT_API}/leads/${encodeURIComponent(id)}/accept`, {
    method: 'POST',
  });
}
