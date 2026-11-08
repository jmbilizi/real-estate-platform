import type { MetadataRoute } from 'next';
import { type ListingCardRow, searchPath } from '@cribstop/property-contracts';
import privacyContent from '@/content/legal/privacy.json';
import termsContent from '@/content/legal/terms.json';
import type { SitemapPlace } from '@/lib/api/sitemap-listings';
import { thinPageMinListings } from '@/lib/seo-config';
import { chunk, chunkCount, isIndexableOrigin, toSitemapEntry } from '@/lib/site-indexing';

/** The home page, plus each legal page once its copy is approved (a draft page is `noindex`). */
export function staticEntries(origin: string): MetadataRoute.Sitemap {
  const base = origin.replace(/\/$/, '');
  const paths = ['/'];
  if (!termsContent.isDraft) paths.push('/terms');
  if (!privacyContent.isDraft) paths.push('/privacy');
  return paths.map((path) => ({ url: `${base}${path === '/' ? '' : path}` }));
}

/**
 * The city pages that may be indexed (#845): the places at or above the listing threshold, the
 * same rule `searchPathMetadata` applies to a city page. `lastmod` is the newest `lastUpdated` of
 * the place's Active listings, so it moves only when a listing there changes.
 */
export function placeEntries(
  origin: string,
  places: readonly SitemapPlace[],
  minListings = thinPageMinListings(),
): MetadataRoute.Sitemap {
  const base = origin.replace(/\/$/, '');
  return places
    .filter((place) => place.activeCount >= minListings)
    .map((place) => ({
      url: `${base}${searchPath({ kind: 'city', city: place.city, state: place.state }, place.segment)}`,
      lastModified: new Date(place.lastUpdated),
    }));
}

/**
 * Every entry in order: static pages, city pages, then listings. Empty off the production origin.
 */
export function allEntries(
  origin: string | null,
  listings: readonly ListingCardRow[],
  places: readonly SitemapPlace[] = [],
): MetadataRoute.Sitemap {
  if (origin === null || !isIndexableOrigin(origin)) return [];
  return [
    ...staticEntries(origin),
    ...placeEntries(origin, places),
    ...listings.map((card) => toSitemapEntry(card, origin)),
  ];
}

export function sitemapChunk(
  origin: string | null,
  listings: readonly ListingCardRow[],
  index: number,
  places: readonly SitemapPlace[] = [],
): MetadataRoute.Sitemap {
  return chunk(allEntries(origin, listings, places), index);
}

export function sitemapChunkIds(
  origin: string | null,
  listings: readonly ListingCardRow[],
  places: readonly SitemapPlace[] = [],
): { id: number }[] {
  return Array.from(
    { length: chunkCount(allEntries(origin, listings, places).length) },
    (_, id) => ({ id }),
  );
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
