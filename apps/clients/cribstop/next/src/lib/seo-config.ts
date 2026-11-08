/**
 * The fewest active listings an indexable place page may have (#842). A page below it is
 * `noindex, follow`, because a thin page at scale is a low-value page. Set
 * `THIN_PAGE_MIN_LISTINGS` to change it without a code change.
 */
const DEFAULT_THIN_PAGE_MIN_LISTINGS = 10;

export function thinPageMinListings(env: Record<string, string | undefined> = process.env): number {
  const parsed = Number.parseInt(env.THIN_PAGE_MIN_LISTINGS ?? '', 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_THIN_PAGE_MIN_LISTINGS;
}

/**
 * How the query string of a search path affects indexing (#847).
 *
 * - `clean`: no parameter. The path is the canonical page and may be indexed.
 * - `paginated`: only `?page=n` with n of 2 or more. The page is `noindex, follow`, so the links
 *   on it still reach the listings. Its canonical is itself.
 * - `filtered`: any other parameter (`boundary`, `bounds`, a filter, `page=1`). The page is
 *   `noindex, follow` and its canonical is the clean path.
 */
export type SearchUrlKind =
  | { readonly kind: 'clean' }
  | { readonly kind: 'paginated'; readonly page: number }
  | { readonly kind: 'filtered' };

/** Tracking parameters change no result. A link that carries one is still the clean page. */
const TRACKING_KEYS = new Set(['fbclid', 'gclid', 'msclkid', 'igshid', 'ref', 'mc_cid', 'mc_eid']);

function isTrackingKey(key: string): boolean {
  return key.startsWith('utm_') || TRACKING_KEYS.has(key);
}

export function searchUrlKind(params: URLSearchParams): SearchUrlKind {
  const keys = [...new Set(params.keys())].filter((key) => !isTrackingKey(key));
  if (keys.length === 0) return { kind: 'clean' };
  const values = params.getAll('page');
  if (keys.length === 1 && keys[0] === 'page' && values.length === 1) {
    const page = Number(values[0]);
    if (/^\d+$/.test(values[0]) && Number.isSafeInteger(page) && page >= 2) {
      return { kind: 'paginated', page };
    }
  }
  return { kind: 'filtered' };
}

/** The canonical URL for a search path, or null when no origin is published. */
export function searchCanonical(
  origin: string | null,
  cleanPath: string,
  url: SearchUrlKind,
): string | null {
  if (origin === null) return null;
  const base = `${origin.replace(/\/$/, '')}${cleanPath}`;
  return url.kind === 'paginated' ? `${base}?page=${url.page}` : base;
}
