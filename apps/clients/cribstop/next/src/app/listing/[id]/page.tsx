import type { Metadata } from 'next';
import { headers } from 'next/headers';
import StandaloneListingView from '@/components/listing/StandaloneListingView';
import { loadListingState } from '@/lib/api/listings-server';
import { listingMetadata, unresolvedListingMetadata } from '@/lib/listing-metadata';

/** A bare `host[:port]` — a name or an IPv4 literal. A forwarded value of any other shape is not
 *  a host we will publish, whoever sent it. */
const HOST_PATTERN = /^[a-z0-9.-]+(:\d{1,5})?$/i;

const LOOPBACK_PATTERN = /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?)(:\d+)?$/i;

/**
 * The absolute origin to publish in `og:url` and the canonical link.
 *
 * `SITE_ORIGIN` is the answer wherever the public hostname is known. It is deliberately first:
 * a forwarded header is client-controlled, and a crafted `X-Forwarded-Host` on a real listing
 * would otherwise publish a canonical URL on someone else's host — to a crawler that follows it.
 *
 * With no configured origin the request headers are the only value that is right in every
 * environment, so they are the fallback, validated rather than trusted: the first entry of a
 * proxy chain, and only if it is shaped like a host.
 */
async function requestOrigin(): Promise<string> {
  const configured = process.env.SITE_ORIGIN;
  if (configured) return configured.replace(/\/$/, '');

  const headerList = await headers();
  const forwarded = (headerList.get('x-forwarded-host') ?? headerList.get('host') ?? '')
    .split(',')[0]
    .trim();
  const host = HOST_PATTERN.test(forwarded) ? forwarded : 'localhost:3000';
  const proto = headerList.get('x-forwarded-proto')?.split(',')[0].trim();

  return `${proto ?? (LOOPBACK_PATTERN.test(host) ? 'http' : 'https')}://${host}`;
}

/** The listing's link preview. The rules it obeys live in `lib/listing-metadata`. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const state = await loadListingState(id);

  if (state.status === 'ready') return listingMetadata(state.listing, await requestOrigin());

  /*
   * Only a listing that is genuinely gone asks to be de-indexed. A gateway hiccup is transient,
   * and answering it with `noindex` on an HTTP 200 would drop live listings out of search for as
   * long as it takes a crawler to come back.
   */
  return unresolvedListingMetadata({ noindex: state.status === 'not-found' });
}

/**
 * A **hard** navigation to a listing — a shared link, a bookmark, a reload.
 *
 * This used to `redirect('/?listing=<id>')`, which made opening a listing URL the slowest thing the
 * app does: a redirect round trip, then a full homepage render, then the homepage's own six API
 * calls, all before the client had even mounted the modal. The listing the user actually asked for
 * was the 7th request. Rendering the listing here removed the redirect and the homepage.
 *
 * What that did not fix was the *order things appear in*. The modal was still a client component
 * that fetched after hydration, and `Modal` renders nothing until an effect has run — so the
 * document went out with an empty `<main>`, the browser painted a bare header and footer, and only
 * then did the listing pop in over it. Resolving the listing here instead means the panel is in the
 * first HTML, fully populated, with no client request at all.
 *
 * The city's search results then mount *behind* it, from an effect, so a direct load ends up
 * looking like an intercepted one — and closing the modal reveals a page that is already there.
 * The ordering is deliberate and one-way: the listing cannot wait on the backdrop, only the
 * reverse. `loading.tsx` covers the server fetch.
 *
 * Soft navigation does not land here, and no longer navigates at all. A card click opens the panel
 * as client state (`lib/listing-panel`, rendered by `ListingPanelHost` in the root layout) and
 * pushes this same URL with `history.pushState`, so the page you were on stays mounted underneath
 * and nothing is fetched to draw the panel. The intercepting route that used to do this job —
 * `@modal/(.)listing/[id]` — was removed for that reason; see the root layout's note.
 *
 * So only a hard navigation reaches this file, which is why closing is `StandaloneListingView`'s
 * business rather than `router.back()`'s: there is no history entry behind this one to step back to.
 */
export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const initialState = await loadListingState(id);

  /**
   * The search that would have produced this listing.
   *
   * `q` is the same parameter the search bar builds, so this is the city's real result set rather
   * than a decorative approximation — and the same string becomes the URL when the panel closes,
   * which is what makes closing continuous with what was already on screen. A listing that failed
   * to load has no city to search, so there is nothing to put behind it and close falls back.
   *
   * `"City, ST"` — the same label the search bar writes for a location suggestion, so the bar reads
   * the way it would if the search had been typed, and the close destination is a URL a person
   * would recognise as theirs. Matching it is `buildListingsQuery`'s job: the API has no state
   * field to match against yet (#81), so the proxy drops the state before forwarding (#80). Do not
   * shorten this to the city to compensate — the display and the match are two different concerns,
   * and collapsing them here is what made the search bar's own URLs return nothing.
   */
  const cityQuery =
    initialState.status === 'ready'
      ? `q=${encodeURIComponent(`${initialState.listing.city}, ${initialState.listing.state}`)}`
      : null;

  return <StandaloneListingView id={id} initialState={initialState} cityQuery={cityQuery} />;
}
