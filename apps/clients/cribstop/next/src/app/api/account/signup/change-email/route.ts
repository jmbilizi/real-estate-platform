import { badRequest, relayPost, stringField } from '@/app/api/_lib/account-relay';

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const oldEmail = stringField(body, 'oldEmail');
  const newEmail = stringField(body, 'newEmail');
  if (!oldEmail || !newEmail) return badRequest('invalid_email');
  return relayPost('/account/signup/change-email', { oldEmail, newEmail }, 'signup change-email');
}
