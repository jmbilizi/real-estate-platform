import { badRequest, relayPost, stringField } from '@/app/api/_lib/account-relay';

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = stringField(body, 'email');
  const code = stringField(body, 'code');
  if (!email || !code) return badRequest();
  return relayPost('/account/password/reset/verify', { email, code }, 'password reset verify');
}
