import { NextRequest } from 'next/server';
import { invalidRequest, proxyStaff, STAFF_API } from '../../../_lib/proxy';

/** The body is rebuilt from an allowlist: `body`. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const input = await req.json().catch(() => null);
  if (typeof input?.body !== 'string') return invalidRequest();
  return proxyStaff(req, `${STAFF_API}/leads/${encodeURIComponent(id)}/notes`, {
    method: 'POST',
    body: { body: input.body },
  });
}
