import { NextRequest, NextResponse } from 'next/server';
import { tryRefreshToken } from '@/app/api/_lib/refresh';
import { STAFF_REFRESH_COOKIE } from '@/lib/api/staff-server';

/**
 * Renews an expired access token, then returns to the lead list of the area that asked.
 * `?to=agent` returns to `/agent/leads`. Any other value returns to `/admin/leads`, so the
 * parameter never works as an open redirect.
 * The `/admin` and `/agent` layouts send the browser here because a server component cannot set cookies.
 * The one-shot cookie keeps a token that stays bad from looping: the layout then closes the gate.
 */
export async function GET(req: NextRequest) {
  await tryRefreshToken();
  const target = req.nextUrl.searchParams.get('to') === 'agent' ? '/agent/leads' : '/admin/leads';
  const res = NextResponse.redirect(new URL(target, req.url));
  res.cookies.set(STAFF_REFRESH_COOKIE, '1', { maxAge: 10, path: '/', httpOnly: true });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}
