import { NextRequest } from 'next/server';
import { badRequest, relay, stringField, unavailable } from '@/app/api/_lib/account-relay';
import { postAuthed, reissueSession } from '@/app/api/_lib/authed-relay';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const code = stringField(body, 'code');
  if (!code) return badRequest();

  const upstream = await postAuthed(
    req,
    '/account/email/change/verify',
    { code },
    'email change verify',
  );
  if (!upstream) return unavailable();
  if (!upstream.ok) return relay(upstream);
  return reissueSession(req, upstream, true, stringField(body, 'newEmail'));
}
