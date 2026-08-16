import type { ErrorBody, ListingDetail } from '@cribstop/property-contracts';
import { fetchGateway } from '@/app/api/_lib/gateway';
import { type ListingDetailState, toListingDetailView } from './listings';

/**
 * Server-side loader for one listing's detail.
 *
 * `getListing` in `./listings` is the browser's path: it calls this app's own `/api/listings/[id]`
 * route handler, which makes the gateway hop. A server component cannot use it — a relative URL has
 * nothing to resolve against — and should not want to, because going out to our own route handler
 * from inside the server would be a pointless extra hop. This makes the same gateway call the route
 * handler makes, directly.
 *
 * **Server modules only.** It reads `API_GATEWAY_URL`, which is deliberately not `NEXT_PUBLIC_`; a
 * client component that imported it would pull the gateway address into the browser bundle.
 */

/** The gateway namespace for the Property API — the same constant the route handlers proxy to. */
const PROPERTY_LISTING = '/property/listings';

const UNAVAILABLE = 'We could not load this listing just now. Please try again.';

/**
 * Resolves a listing into the state the detail UI renders, never throwing.
 *
 * Every outcome is a state the page can present: the listing, a withdrawn listing, or an error with
 * a retry. A rejected promise here would take out the whole route instead, which is the one thing
 * this page must not do — it exists precisely so that a direct link to a listing renders something.
 */
export async function loadListingState(id: string): Promise<ListingDetailState> {
  const upstream = await fetchGateway(`${PROPERTY_LISTING}/${encodeURIComponent(id)}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  }).catch(() => null);

  if (!upstream) return { status: 'error', message: UNAVAILABLE };

  const body = await upstream.json().catch(() => null);

  if (!upstream.ok) {
    const code = (body as ErrorBody | null)?.error?.code;
    /*
     * Both the 404 and the contract's `not_found` code are required, exactly as in the client's
     * `ListingsApiError.isNotFound`. A gateway route miss is also a 404 but carries no contract
     * body, and rendering "this listing is no longer available" for a misrouted gateway would
     * present an infrastructure fault as a withdrawn home.
     */
    if (upstream.status === 404 && code === 'not_found') return { status: 'not-found' };
    return { status: 'error', message: UNAVAILABLE };
  }

  if (body === null) return { status: 'error', message: UNAVAILABLE };

  return { status: 'ready', listing: toListingDetailView(body as ListingDetail) };
}
