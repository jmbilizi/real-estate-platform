import { NextRequest } from 'next/server';
import { agentDeclineReasonSchema } from '@cribstop/property-contracts';
import { AGENT_API, invalidRequest, proxyStaff } from '../../../../staff/_lib/proxy';

/** The body is rebuilt from the one allowed field: a reason from the fixed list. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const input = await req.json().catch(() => null);
  const reason = agentDeclineReasonSchema.safeParse(input?.reason);
  if (!reason.success) return invalidRequest();
  return proxyStaff(req, `${AGENT_API}/leads/${encodeURIComponent(id)}/decline`, {
    method: 'POST',
    body: { reason: reason.data },
  });
}
