import { NextResponse } from 'next/server';
import { googleClientId } from '@/lib/google-config';

/**
 * Tells the browser the Google OAuth client ID, or `null` when sign-in with Google is off (#1049).
 * The ID is public. The button stays hidden while it is `null`.
 *
 * `GOOGLE_CLIENT_ID` is read per request, not at build time. The image is built once and each
 * environment injects its own value at pod start.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(
    { clientId: googleClientId(process.env.GOOGLE_CLIENT_ID) },
    { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=60' } },
  );
}
