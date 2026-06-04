import { NextResponse } from 'next/server';
import { clearAuthCookies } from '@/app/api/_lib/cookies';

export async function POST() {
  const res = NextResponse.json({ success: true });

  for (const c of clearAuthCookies()) {
    res.cookies.set(c.name, c.value, c.opts);
  }

  return res;
}
