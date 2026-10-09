import { loadSitemapListings } from '@/lib/api/sitemap-listings';
import { publishableOrigin } from '@/lib/publishable-origin';
import { allEntries, sitemapIndexXml } from '@/lib/sitemap-entries';
import { chunkCount, isIndexableOrigin } from '@/lib/site-indexing';

export const dynamic = 'force-dynamic';

/** `generateSitemaps` serves `/sitemap/<id>.xml` chunks but no index. This route is the index. */
export async function GET() {
  const origin = publishableOrigin();
  if (origin === null || !isIndexableOrigin(origin)) {
    return new Response('Not found', { status: 404 });
  }
  const entries = allEntries(origin, await loadSitemapListings());
  return new Response(sitemapIndexXml(origin, chunkCount(entries.length)), {
    headers: { 'Content-Type': 'application/xml' },
  });
}
