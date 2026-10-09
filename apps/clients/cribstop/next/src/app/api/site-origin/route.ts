import { NextResponse } from 'next/server';
import { publishableOrigin } from '@/lib/publishable-origin';

// `SITE_ORIGIN` is per environment and read at pod start, never at build time.
export const dynamic = 'force-dynamic';

/** The public origin the server publishes in canonical links. Share links read the same value. */
export function GET() {
  return NextResponse.json({ origin: publishableOrigin() });
}
