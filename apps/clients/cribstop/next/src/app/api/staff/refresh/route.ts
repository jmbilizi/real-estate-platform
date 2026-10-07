import { NextRequest, NextResponse } from 'next/server';
import { tryRefreshToken } from '@/app/api/_lib/refresh';
import { STAFF_REFRESH_COOKIE } from '@/lib/api/staff-server';

/**
 * Renews an expired access token for the staff area, then returns to the lead list.
 * The `/admin` layout sends the browser here because a server component cannot set cookies.
 * The one-shot cookie keeps a token that stays bad from looping: the layout then closes the gate.
 */
export async function GET(req: NextRequest) {
  await tryRefreshToken();
  const res = NextResponse.redirect(new URL('/admin/leads', req.url));
  res.cookies.set(STAFF_REFRESH_COOKIE, '1', { maxAge: 10, path: '/', httpOnly: true });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}
