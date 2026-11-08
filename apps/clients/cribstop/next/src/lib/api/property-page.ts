import { cache } from 'react';
import { propertyLookupResponseSchema, propertyPageSchema } from '@cribstop/property-contracts';
import type { ErrorBody, PropertyMatch, PropertyPage } from '@cribstop/property-contracts';
import { fetchGateway } from '@/app/api/_lib/gateway';

/**
 * Server-side loaders for the property page (#382).
 *
 * Same pattern as `./listings-server`: server modules only, reads `API_GATEWAY_URL` directly, and
 * every outcome is a state the route renders rather than a thrown error — a rejected promise here
 * would take out the whole route instead of the one page that failed to resolve.
 */

const PROPERTY_LISTING = '/property/listings';
const PROPERTY_LOOKUP = '/property/properties/lookup';
const PROPERTY_HOME = '/property/properties';

/**
 * How long Next keeps a property page response (#890). A cold gateway call took 2.4 s on the detail
 * page. Next stores only a 200, so a 404 or a failure is never kept. A price or status change shows
 * within this window.
 */
export const PROPERTY_PAGE_REVALIDATE_SECONDS = 60;

const UNAVAILABLE = 'We could not load this property just now. Please try again.';

export type PropertyPageState =
  | { status: 'ready'; page: PropertyPage }
  | { status: 'not-found' }
  | { status: 'error'; message: string };

async function fetchPage(path: string): Promise<PropertyPageState> {
  const upstream = await fetchGateway(path, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    next: { revalidate: PROPERTY_PAGE_REVALIDATE_SECONDS },
  }).catch(() => null);

  if (!upstream) return { status: 'error', message: UNAVAILABLE };

  const body = await upstream.json().catch(() => null);

  if (!upstream.ok) {
    const code = (body as ErrorBody | null)?.error?.code;
    if (upstream.status === 404 && code === 'not_found') return { status: 'not-found' };
    return { status: 'error', message: UNAVAILABLE };
  }

  const parsed = propertyPageSchema.safeParse(body);
  if (!parsed.success) return { status: 'error', message: UNAVAILABLE };

  return { status: 'ready', page: parsed.data };
}

/**
 * `GET /property/listings/{id}/page`: the page of the home one listing is on. `cache` dedupes the
 * route's `generateMetadata` and page readers into one gateway call.
 */
export const loadPropertyPage = cache(async function loadPropertyPage(
  listingId: string,
): Promise<PropertyPageState> {
  return fetchPage(`${PROPERTY_LISTING}/${encodeURIComponent(listingId)}/page`);
});

/**
 * `GET /property/properties/{propertyId}/page`: the page of one home, keyed by the property or
 * unit id. Only for a stale #382 URL: the property page route falls back to this when `id` is not
 * a listing id, so a link minted before the #386 correction still 308s to its canonical URL.
 */
export const loadPropertyByHomeId = cache(async function loadPropertyByHomeId(
  propertyId: string,
): Promise<PropertyPageState> {
  return fetchPage(`${PROPERTY_HOME}/${encodeURIComponent(propertyId)}/page`);
});

export type PropertyLookupState =
  | { status: 'ready'; match: PropertyMatch }
  /** More than one property answers the two path segments: the route renders a choice page. */
  | { status: 'ambiguous'; matches: PropertyMatch[] }
  | { status: 'not-found' }
  | { status: 'error'; message: string };

/**
 * `GET /property/properties/lookup?city=<citySegment>&address=<addressSegment>`.
 *
 * A 400 (malformed segments) reads the same as a 404 here: the caller only reaches this with
 * segments that already passed `isCitySegment`/`isAddressSegment`, so a 400 means nothing resolves
 * for this path either way, and the route has one dead end to render, not two.
 */
export const lookupProperty = cache(async function lookupProperty(
  citySegment: string,
  addressSegment: string,
): Promise<PropertyLookupState> {
  const params = new URLSearchParams({ city: citySegment, address: addressSegment }).toString();
  const upstream = await fetchGateway(`${PROPERTY_LOOKUP}?${params}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  }).catch(() => null);

  if (!upstream) return { status: 'error', message: UNAVAILABLE };

  const body = await upstream.json().catch(() => null);

  if (!upstream.ok) {
    if (upstream.status === 404 || upstream.status === 400) return { status: 'not-found' };
    return { status: 'error', message: UNAVAILABLE };
  }

  const parsed = propertyLookupResponseSchema.safeParse(body);
  if (!parsed.success) return { status: 'error', message: UNAVAILABLE };

  const { matches } = parsed.data;
  return matches.length === 1
    ? { status: 'ready', match: matches[0] as PropertyMatch }
    : { status: 'ambiguous', matches };
});
