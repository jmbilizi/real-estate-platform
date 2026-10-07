import { badRequest, relayPost, stringField } from '@/app/api/_lib/account-relay';

/** The "This wasn't me" link (#662). POST only: a GET never acts on the token. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const token = stringField(body, 'token');
  if (!token) return badRequest('invalid_token');
  return relayPost('/account/secure', { token }, 'secure account');
}
