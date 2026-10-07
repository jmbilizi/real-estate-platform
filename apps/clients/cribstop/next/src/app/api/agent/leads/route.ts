import { NextRequest } from 'next/server';
import { leadStatusSchema } from '@cribstop/property-contracts';
import { AGENT_API, invalidRequest, proxyStaff } from '../../staff/_lib/proxy';

/** Only `status` is forwarded, and only a valid one. The service scopes the list to the caller. */
export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get('status');
  if (status === null) return proxyStaff(req, `${AGENT_API}/leads`, { method: 'GET' });
  const parsed = leadStatusSchema.safeParse(status);
  if (!parsed.success) return invalidRequest();
  return proxyStaff(req, `${AGENT_API}/leads?status=${parsed.data}`, { method: 'GET' });
}
