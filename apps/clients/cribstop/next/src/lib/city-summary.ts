import type { ListingSource } from '@cribstop/property-contracts';
import { BRAND } from '@/lib/brand';
import { formatDate, formatPrice } from '@/lib/format';

/** Figures for a place page (#842). Every figure carries `asOf`. */
export interface CityStats {
  /** Active listings the feed publishes. A suppressed listing is not in the feed. */
  readonly activeCount: number;
  /** Median list price over the listings that publish a price. Null when none does. */
  readonly medianPrice: number | null;
  /** ISO instant the figures describe. */
  readonly asOf: string;
  readonly sources: readonly ListingSource[];
}

export type PathSegment = 'homes-for-sale' | 'homes-for-rent';

const nounOf = (segment: PathSegment) =>
  segment === 'homes-for-rent' ? 'Homes for rent' : 'Homes for sale';

/**
 * The 1-based ranks that give the median of `count` sorted values: one rank for an odd count, two
 * for an even count. Null for no value.
 */
export function medianFromRanks(count: number): [number] | [number, number] | null {
  if (count <= 0) return null;
  const mid = Math.floor(count / 2);
  return count % 2 === 1 ? [mid + 1] : [mid, mid + 1];
}

export function cityTitle(label: string, segment: PathSegment): string {
  return `${nounOf(segment)} in ${label} · ${BRAND.brokerage}`;
}

/**
 * `noindex, follow` below the threshold and when the count is unknown. An unknown count is a
 * failed read, so the page stays out of the index until the read works.
 */
export function cityRobots(
  activeCount: number | null,
  minListings: number,
): { index: boolean; follow: true } {
  return { index: activeCount !== null && activeCount >= minListings, follow: true };
}

/**
 * Two or three sentences, composed from the figures only. It makes no claim about people,
 * schools, safety or fit (Fair Housing, PRD §6.1).
 */
export function citySummary(label: string, segment: PathSegment, stats: CityStats): string {
  const rent = segment === 'homes-for-rent';
  const date = formatDate(stats.asOf);
  const noun = stats.activeCount === 1 ? 'listing' : 'listings';
  const count = `${stats.activeCount.toLocaleString('en-US')} active ${noun}`;
  const first = `As of ${date}, ${label} has ${count} ${rent ? 'for rent' : 'for sale'}.`;
  const median =
    stats.medianPrice === null
      ? null
      : `The median list ${rent ? 'rent' : 'price'} is ${formatPrice(stats.medianPrice, rent ? 'rent' : 'sale')}, as of ${date}.`;
  const source = stats.sources.includes('brightMLS')
    ? 'Source: Bright MLS.'
    : `Source: listings published on ${BRAND.siteDomain}.`;
  return [first, median, source].filter(Boolean).join(' ');
}
