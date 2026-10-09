import type { MetadataRoute } from 'next';
import type { ListingCardRow } from '@cribstop/property-contracts';

/** The one origin search engines may index. Every other origin, or none, is disallow-all. */
export const PRODUCTION_ORIGIN = 'https://cribstop.com';

/** The sitemap protocol limit for one file. */
export const SITEMAP_CHUNK_SIZE = 50_000;

/** Pages that need a session or carry no search value. Mirrors the route tree. */
export const DISALLOWED_PATHS = [
  '/api/',
  '/admin',
  '/agent',
  '/login',
  '/signup',
  '/forgot-password',
  '/secure-account',
] as const;

/** True only when `origin` is the production origin. Never derived from an environment name. */
export function isIndexableOrigin(origin: string | null): boolean {
  return origin !== null && origin.replace(/\/$/, '') === PRODUCTION_ORIGIN;
}

/** The sitemap index URL. It is a route handler because `generateSitemaps` emits no index. */
export function sitemapIndexUrl(origin: string): string {
  return `${origin.replace(/\/$/, '')}/sitemap-index.xml`;
}

export function robotsFor(origin: string | null): MetadataRoute.Robots {
  if (origin === null || !isIndexableOrigin(origin)) {
    return { rules: { userAgent: '*', disallow: '/' } };
  }
  return {
    rules: { userAgent: '*', allow: '/', disallow: [...DISALLOWED_PATHS] },
    sitemap: sitemapIndexUrl(origin),
  };
}

/**
 * Whether a listing may appear in a sitemap.
 *
 * The Property API already omits a listing whose `internetDisplayAllowed` is false (PRD §6.2), so
 * the card has no such field. The rules left here: a suppressed address (null) never appears, a
 * sample row never appears, and only consumer-visible open statuses appear.
 */
export function isSitemapEligible(
  card: Pick<ListingCardRow, 'address' | 'isSample' | 'status'>,
): boolean {
  if (card.address === null || card.isSample) return false;
  return card.status === 'Active' || card.status === 'Coming Soon' || card.status === 'Pending';
}

export function toSitemapEntry(
  card: Pick<ListingCardRow, 'propertyPath' | 'lastUpdated'>,
  origin: string,
): MetadataRoute.Sitemap[number] {
  return {
    url: `${origin.replace(/\/$/, '')}${card.propertyPath}`,
    lastModified: new Date(card.lastUpdated),
  };
}

export function chunkCount(total: number, size = SITEMAP_CHUNK_SIZE): number {
  return Math.max(1, Math.ceil(total / size));
}

export function chunk<T>(items: readonly T[], index: number, size = SITEMAP_CHUNK_SIZE): T[] {
  return items.slice(index * size, (index + 1) * size);
}
