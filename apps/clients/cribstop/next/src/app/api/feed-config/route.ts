import { NextResponse } from 'next/server';
import { parseHomeFeedFlags } from '@/lib/home-feed';

/**
 * Runtime home-feed flags (#836). The home page stays static. The client reads this small
 * answer, then buckets itself. A shared cache holds it for 60 s, so a flag change reaches
 * visitors within a minute.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  const flags = parseHomeFeedFlags({
    HOME_FEED_ENABLED: process.env.HOME_FEED_ENABLED,
    HOME_FEED_ROLLOUT_PCT: process.env.HOME_FEED_ROLLOUT_PCT,
  });
  return NextResponse.json(flags, {
    headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=60' },
  });
}
