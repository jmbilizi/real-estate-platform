import { cache } from 'react';
import { propertyLookupResponseSchema, propertyPageSchema } from '@cribstop/property-contracts';
import type { ErrorBody, PropertyMatch, PropertyPage } from '@cribstop/property-contracts';
import { fetchGateway } from '@/app/api/_lib/gateway';

/**
 * Server-side loaders for the property page (#349).
 *
 * Same pattern as `./listings-server`: server modules only, reads `API_GATEWAY_URL` directly, and
 * every outcome is a state the route renders rather than a thrown error — a rejected promise here
 * would take out the whole route instead of the one page that failed to resolve.
 */

const PROPERTY_LISTING = '/property/listings';
const PROPERTY_LOOKUP = '/property/properties/lookup';

const UNAVAILABLE = 'We could not load this property just now. Please try again.';

export type PropertyPageState =
  | { status: 'ready'; page: PropertyPage }
  | { status: 'not-found' }
  | { status: 'error'; message: string };

/** `GET /property/listings/{id}/page`. `cache` dedupes the route's `generateMetadata` and page
 *  readers into one gateway call, same reason as `loadListingState`. */
export const loadPropertyPage = cache(async function loadPropertyPage(
  listingId: string,
): Promise<PropertyPageState> {
  const upstream = await fetchGateway(`${PROPERTY_LISTING}/${encodeURIComponent(listingId)}/page`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
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
