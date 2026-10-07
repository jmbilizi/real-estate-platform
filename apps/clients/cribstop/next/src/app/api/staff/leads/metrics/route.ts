import { NextRequest } from 'next/server';
import { staffLeadMetricsRequestSchema } from '@cribstop/property-contracts';
import { proxyStaff, STAFF_API } from '../../_lib/proxy';

/** The forwardable parameters come from the contract's query schema. The service validates the values. */
const FORWARDED = Object.keys(staffLeadMetricsRequestSchema.shape);

export async function GET(req: NextRequest) {
  const query = new URLSearchParams();
  for (const key of FORWARDED) {
    const value = req.nextUrl.searchParams.get(key);
    if (value) query.set(key, value);
  }
  const qs = query.toString();
  return proxyStaff(req, `${STAFF_API}/leads/metrics${qs ? `?${qs}` : ''}`, { method: 'GET' });
}
