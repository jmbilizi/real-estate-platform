import { NextRequest } from 'next/server';
import { AGENT_STATUS_TARGETS } from '@cribstop/property-contracts';
import { AGENT_API, invalidRequest, proxyStaff } from '../../../../staff/_lib/proxy';

/** The body is rebuilt from an allowlist: `to` and `note`. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const input = await req.json().catch(() => null);
  const to = input?.to;
  if (!AGENT_STATUS_TARGETS.some((t) => t === to)) return invalidRequest();
  if (input.note !== undefined && typeof input.note !== 'string') return invalidRequest();
  const body: { to: string; note?: string } = { to };
  if (input.note !== undefined) body.note = input.note;
  return proxyStaff(req, `${AGENT_API}/leads/${encodeURIComponent(id)}/status`, {
    method: 'POST',
    body,
  });
}
