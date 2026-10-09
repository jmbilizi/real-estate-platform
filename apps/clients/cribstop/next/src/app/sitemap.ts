import type { MetadataRoute } from 'next';
import { connection } from 'next/server';
import { loadSitemapListings } from '@/lib/api/sitemap-listings';
import { publishableOrigin } from '@/lib/publishable-origin';
import { sitemapChunk, sitemapChunkIds } from '@/lib/sitemap-entries';

// Reads `SITE_ORIGIN` and the live listing feed per request, never at build time.
export const dynamic = 'force-dynamic';

export async function generateSitemaps() {
  const origin = publishableOrigin();
  return sitemapChunkIds(origin, origin ? await loadSitemapListings() : []);
}

export default async function sitemap({
  id,
}: {
  id: string | number | Promise<string | number>;
}): Promise<MetadataRoute.Sitemap> {
  // Opts out of build-time prerender, which would bake an empty chunk (no `SITE_ORIGIN` at build).
  await connection();
  const origin = publishableOrigin();
  const index = Number(await id);
  return sitemapChunk(origin, origin ? await loadSitemapListings() : [], index);
}
