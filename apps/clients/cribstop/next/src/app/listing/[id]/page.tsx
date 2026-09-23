import type { Metadata } from 'next';
import StandaloneListingView from '@/components/listing/StandaloneListingView';
import { loadListingState } from '@/lib/api/listings-server';
import { listingMetadata, unresolvedListingMetadata } from '@/lib/listing-metadata';

/**
 * The origin to publish in the canonical link and `og:url`, or null when we have none to vouch
 * for.
 *
 * Only `SITE_ORIGIN` counts. The request's `Host` / `X-Forwarded-Host` is client-controlled and
 * the ingress rule for this app is a catch-all, so a crafted header would otherwise publish a real
 * listing's canonical URL on an attacker's domain — to the one audience that acts on it, a
 * crawler. `SITE_ORIGIN` is not wired per environment yet, so today both tags are simply omitted.
 */
function publishableOrigin(): string | null {
  const configured = process.env.SITE_ORIGIN?.trim();
  return configured ? configured.replace(/\/$/, '') : null;
}

/** The listing's link preview. The rules it obeys live in `lib/listing-metadata`. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const state = await loadListingState(id);

  if (state.status === 'ready') return listingMetadata(state.listing, publishableOrigin());

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
   * `q` carries the display label the search bar would write for this place, so the bar reads the
   * way it would if the search had been typed, and the close destination is a URL a person would
   * recognise as theirs. `city`/`state` are the exact match the search bar itself now sends for a
   * city/town/village pick (#220) — sent alongside `q` here for the same reason: an exact city
   * match, never a substring guess that could land on a same-named city elsewhere. A listing that
   * failed to load has no city to search, so there is nothing to put behind it and close falls back.
   */
  const cityQuery =
    initialState.status === 'ready'
      ? new URLSearchParams({
          q: `${initialState.listing.city}, ${initialState.listing.state}`,
          city: initialState.listing.city,
          state: initialState.listing.state,
        }).toString()
      : null;

  return <StandaloneListingView id={id} initialState={initialState} cityQuery={cityQuery} />;
}
