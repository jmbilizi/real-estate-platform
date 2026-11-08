import { loadSitemapFeed } from '@/lib/api/sitemap-listings';
import { publishableOrigin } from '@/lib/publishable-origin';
import { allEntries, sitemapIndexXml } from '@/lib/sitemap-entries';
import { chunkCount, isIndexableOrigin } from '@/lib/site-indexing';

export const dynamic = 'force-dynamic';

/**
 * A crawler or a CDN may keep the index for 10 minutes, and may serve a stale copy for an hour
 * while it refreshes (#845). The feed behind it also caches for 10 minutes.
 */
const CACHE_CONTROL = 'public, max-age=300, s-maxage=600, stale-while-revalidate=3600';

/** `generateSitemaps` serves `/sitemap/<id>.xml` chunks but no index. This route is the index. */
export async function GET() {
  const origin = publishableOrigin();
  if (origin === null || !isIndexableOrigin(origin)) {
    return new Response('Not found', { status: 404 });
  }
  const { listings, places } = await loadSitemapFeed();
  const entries = allEntries(origin, listings, places);
  return new Response(sitemapIndexXml(origin, chunkCount(entries.length)), {
    headers: { 'Content-Type': 'application/xml', 'Cache-Control': CACHE_CONTROL },
  });
}
