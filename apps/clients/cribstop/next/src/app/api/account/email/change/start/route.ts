import { NextRequest } from 'next/server';
import { badRequest, relay, stringField, unavailable } from '@/app/api/_lib/account-relay';
import { postAuthed } from '@/app/api/_lib/authed-relay';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const newEmail = stringField(body, 'newEmail');
  if (!newEmail) return badRequest();
  const payload: Record<string, string> = { newEmail };
  // The password is never trimmed: the server checks exactly what the user typed.
  if (typeof body?.currentPassword === 'string' && body.currentPassword) {
    payload.currentPassword = body.currentPassword;
  }
  const oldEmailCode = stringField(body, 'oldEmailCode');
  if (oldEmailCode) payload.oldEmailCode = oldEmailCode;

  const upstream = await postAuthed(
    req,
    '/account/email/change/start',
    payload,
    'email change start',
  );
  return upstream ? relay(upstream) : unavailable();
}
