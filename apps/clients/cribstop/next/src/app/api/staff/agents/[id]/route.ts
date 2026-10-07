import { NextRequest } from 'next/server';
import { updateAgentProfileRequestSchema } from '@cribstop/property-contracts';
import { invalidRequest, proxyStaff, STAFF_API } from '../../_lib/proxy';

const PATCH_KEYS = Object.keys(updateAgentProfileRequestSchema.shape);

/** The body is rebuilt from the contract's keys. The account never changes. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const input = await req.json().catch(() => null);
  if (typeof input !== 'object' || input === null) return invalidRequest();
  const body = Object.fromEntries(PATCH_KEYS.filter((k) => k in input).map((k) => [k, input[k]]));
  return proxyStaff(req, `${STAFF_API}/agents/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body,
  });
}
