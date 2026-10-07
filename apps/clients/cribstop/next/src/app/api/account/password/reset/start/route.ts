import { badRequest, relayPost, stringField } from '@/app/api/_lib/account-relay';

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = stringField(body, 'email');
  if (!email) return badRequest();
  return relayPost('/account/password/reset/start', { email }, 'password reset start');
}
