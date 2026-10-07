import { NextRequest } from 'next/server';
import { staffLeadsRequestSchema } from '@cribstop/property-contracts';
import { proxyStaff, STAFF_API } from '../_lib/proxy';

/**
 * The forwardable parameters come from the contract's query schema, never a hand-kept list.
 * The service validates the values.
 */
const FORWARDED = Object.keys(staffLeadsRequestSchema.shape);

export async function GET(req: NextRequest) {
  const query = new URLSearchParams();
  for (const key of FORWARDED) {
    const value = req.nextUrl.searchParams.get(key);
    if (value) query.set(key, value);
  }
  const qs = query.toString();
  return proxyStaff(req, `${STAFF_API}/leads${qs ? `?${qs}` : ''}`, { method: 'GET' });
}
