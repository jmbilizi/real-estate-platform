import { NextResponse } from 'next/server';
import { isIndexableOrigin } from '@/lib/site-indexing';

/**
 * Sends `X-Robots-Tag: noindex` on every origin except production. Test inventory must never reach
 * a search index. The decision reads `SITE_ORIGIN` per request, not an environment name.
 */
export function middleware() {
  const response = NextResponse.next();
  if (!isIndexableOrigin(process.env.SITE_ORIGIN?.trim() ?? null)) {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  }
  return response;
}

export const config = {
  matcher: '/((?!_next/static|_next/image|favicon.ico).*)',
};
