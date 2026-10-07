import { NextRequest, NextResponse } from 'next/server';
import { badRequest, relay, unavailable } from '@/app/api/_lib/account-relay';
import { postAuthed, reissueSession } from '@/app/api/_lib/authed-relay';

const POLICY_CODES = ['too_short', 'too_long', 'breached'];
const WRONG_CURRENT = ['PasswordMismatch', 'OldPasswordRequired'];

/** Maps the framework's validation problem to the stable codes the browser reads. */
async function problemToError(upstream: Response): Promise<NextResponse> {
  const body = await upstream.json().catch(() => null);
  const keys = Object.keys(
    body?.errors && typeof body.errors === 'object' ? (body.errors as object) : {},
  );
  if (keys.some((k) => WRONG_CURRENT.includes(k))) {
    return NextResponse.json({ error: 'wrong_password' }, { status: 400 });
  }
  const errors = keys.filter((k) => POLICY_CODES.includes(k));
  if (errors.length > 0) {
    return NextResponse.json({ error: 'password_rejected', errors }, { status: 400 });
  }
  return badRequest();
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  // Passwords are never trimmed: the server checks exactly what the user typed.
  const currentPassword = typeof body?.currentPassword === 'string' ? body.currentPassword : '';
  const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : '';
  if (!currentPassword || !newPassword) return badRequest();

  const upstream = await postAuthed(
    req,
    '/account/manage/info',
    { oldPassword: currentPassword, newPassword },
    'password change',
  );
  if (!upstream) return unavailable();
  if (upstream.status === 400) return problemToError(upstream);
  if (!upstream.ok) return relay(upstream);
  return reissueSession(req, upstream, false);
}
