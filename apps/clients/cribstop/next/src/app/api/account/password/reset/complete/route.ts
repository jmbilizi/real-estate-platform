import { badRequest, relayPost, stringField } from '@/app/api/_lib/account-relay';

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = stringField(body, 'email');
  const resetProof = stringField(body, 'resetProof');
  // The password is never trimmed: the server hashes exactly what the user typed.
  const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : '';
  if (!email || !resetProof || !newPassword) return badRequest();
  return relayPost(
    '/account/password/reset/complete',
    { email, resetProof, newPassword },
    'password reset complete',
  );
}
