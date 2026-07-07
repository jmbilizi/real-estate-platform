import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIES } from '@/app/api/_lib/cookies';

export async function GET(req: NextRequest) {
  const sessionCookie = req.cookies.get(AUTH_COOKIES.session)?.value;
  const hasAccessToken = req.cookies.has(AUTH_COOKIES.accessToken);

  if (!sessionCookie || !hasAccessToken) {
    return NextResponse.json({ authenticated: false });
  }

  const session = JSON.parse(sessionCookie) as { email?: string };

  return NextResponse.json({
    authenticated: true,
    email: session.email ?? null,
  });
}
