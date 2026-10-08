import type { MetadataRoute } from 'next';
import type { ListingCardRow } from '@cribstop/property-contracts';
import privacyContent from '@/content/legal/privacy.json';
import termsContent from '@/content/legal/terms.json';
import { chunk, chunkCount, isIndexableOrigin, toSitemapEntry } from '@/lib/site-indexing';

/** The home page, plus each legal page once its copy is approved (a draft page is `noindex`). */
export function staticEntries(origin: string): MetadataRoute.Sitemap {
  const base = origin.replace(/\/$/, '');
  const paths = ['/'];
  if (!termsContent.isDraft) paths.push('/terms');
  if (!privacyContent.isDraft) paths.push('/privacy');
  return paths.map((path) => ({ url: `${base}${path === '/' ? '' : path}` }));
}

/** Every entry in order: static pages first, then listings. Empty off the production origin. */
export function allEntries(
  origin: string | null,
  listings: readonly ListingCardRow[],
): MetadataRoute.Sitemap {
  if (origin === null || !isIndexableOrigin(origin)) return [];
  return [...staticEntries(origin), ...listings.map((card) => toSitemapEntry(card, origin))];
}

export function sitemapChunk(
  origin: string | null,
  listings: readonly ListingCardRow[],
  index: number,
): MetadataRoute.Sitemap {
  return chunk(allEntries(origin, listings), index);
}

export function sitemapChunkIds(
  origin: string | null,
  listings: readonly ListingCardRow[],
): { id: number }[] {
  return Array.from({ length: chunkCount(allEntries(origin, listings).length) }, (_, id) => ({
    id,
  }));
}

/** The sitemap index XML. It lists each chunk file `generateSitemaps` serves. */
export function sitemapIndexXml(origin: string, chunks: number): string {
  const base = origin.replace(/\/$/, '');
  const items = Array.from(
    { length: chunks },
    (_, id) => `<sitemap><loc>${base}/sitemap/${id}.xml</loc></sitemap>`,
  ).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${items}</sitemapindex>`;
}
