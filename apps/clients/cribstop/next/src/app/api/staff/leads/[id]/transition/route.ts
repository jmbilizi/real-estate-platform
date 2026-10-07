import { NextRequest } from 'next/server';
import { leadStatusSchema } from '@cribstop/property-contracts';
import { invalidRequest, proxyStaff, STAFF_API } from '../../../_lib/proxy';

/** The body is rebuilt from an allowlist: `to` and `note`. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const input = await req.json().catch(() => null);
  const to = leadStatusSchema.safeParse(input?.to);
  if (!to.success || (input.note !== undefined && typeof input.note !== 'string')) {
    return invalidRequest();
  }
  const body: { to: string; note?: string } = { to: to.data };
  if (input.note !== undefined) body.note = input.note;
  return proxyStaff(req, `${STAFF_API}/leads/${encodeURIComponent(id)}/transition`, {
    method: 'POST',
    body,
  });
}
