import { NextRequest } from 'next/server';
import {
  createAgentProfileRequestSchema,
  staffAgentsRequestSchema,
} from '@cribstop/property-contracts';
import { invalidRequest, proxyStaff, STAFF_API } from '../_lib/proxy';

/** Forwardable parameters come from the contract's query schema. The service validates values. */
const FORWARDED = Object.keys(staffAgentsRequestSchema.shape);
/** The body is rebuilt from the contract's keys. Anything else is dropped. */
const CREATE_KEYS = Object.keys(createAgentProfileRequestSchema.shape);

export async function GET(req: NextRequest) {
  const query = new URLSearchParams();
  for (const key of FORWARDED) {
    const value = req.nextUrl.searchParams.get(key);
    if (value) query.set(key, value);
  }
  const qs = query.toString();
  return proxyStaff(req, `${STAFF_API}/agents${qs ? `?${qs}` : ''}`, { method: 'GET' });
}

export async function POST(req: NextRequest) {
  const input = await req.json().catch(() => null);
  if (typeof input !== 'object' || input === null) return invalidRequest();
  const body = Object.fromEntries(CREATE_KEYS.filter((k) => k in input).map((k) => [k, input[k]]));
  return proxyStaff(req, `${STAFF_API}/agents`, { method: 'POST', body });
}
