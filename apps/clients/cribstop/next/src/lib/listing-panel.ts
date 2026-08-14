'use client';

import { useSyncExternalStore } from 'react';
import type { ListingCardRow } from '@/lib/types';

/**
 * Which listing the detail panel is showing, held in client state rather than in the route.
 *
 * **Why this exists at all.** Opening a listing used to be `router.push('/listing/<id>')`, caught by
 * the `@modal/(.)listing/[id]` interceptor, with a `loading.tsx` to cover the wait. The premise was
 * that the loading boundary would paint on the click because it was "already in the bundle". It was
 * not, and the panel was gated on the network in two separate ways. Measured on the search page,
 * from the click:
 *
 * ```
 *    9ms  GET /listing/<id>?_rsc=…            (451ms — the route's RSC payload)
 *  459ms  GET …/(.)listing/[id]/loading.js    (the loading boundary's own chunk)
 *  460ms  GET …/(.)listing/[id]/page.js
 *  519ms  skeleton finally in the DOM
 * ```
 *
 * A `loading.tsx` is part of the segment it belongs to, so the browser cannot render it until that
 * segment's payload *and* its JavaScript have arrived. `router.prefetch` on hover was meant to hide
 * this, but prefetch is a no-op in `next dev`, and it never fires at all for a tap, a keyboard
 * activation, or a pointer that lands on a card without travelling across it. So the click produced
 * half a second to well over a second of nothing but a progress bar — long enough that users clicked
 * a second time, which is the complaint this replaces.
 *
 * **The fix is to stop asking the network for permission to draw a panel.** Nothing about the panel
 * needs a server round trip: the intercepted route resolved no data (it rendered
 * `<ListingDetailModal id>` and let the client fetch), so its payload was pure ceremony. Holding the
 * open listing here means the panel renders from local state on the click itself, and the detail
 * fetch fills it in afterwards — the same fetch as before, just no longer standing between the user
 * and the first frame.
 *
 * **The URL still changes, via the native History API.** `history.pushState` moves the address bar
 * to `/listing/<id>` without a navigation, so the page underneath is never unmounted and never
 * refetched — measured: pushing and going back fires zero requests and leaves the results' DOM nodes
 * the same instances. Next.js keeps `usePathname`/`useSearchParams` in step with the native calls,
 * which is what `SearchExperience` (its own pagination and sort writes) and `StandaloneListingView`
 * (its close) already rely on, so this is the established idiom here rather than a new one.
 *
 * Deliberately a module store read through `useSyncExternalStore` rather than React context. The
 * open has to be settled *synchronously inside the click handler*, before anything re-renders, and
 * it is read by exactly one component; a context provider would add a tree the click has to
 * propagate through to buy nothing.
 */
export interface OpenListingPanel {
  id: string;
  /**
   * The card row the open started from, when there was one.
   *
   * This is what lets the panel open on the listing itself rather than on a grey skeleton — the
   * address, the badges, the price and the primary photo are all already in hand on the results
   * page. It is a `ListingCardRow`, so it carries only card fields: everything detail-only (the
   * gallery beyond the first photo, the description, open houses, full attribution) is **absent**,
   * not null, and stays skeletal until the fetch lands. Absent for an open with no row to hand —
   * a map pin for a listing that is not in the current result set, or a forward-navigation.
   */
  row?: ListingCardRow;
}

let openPanel: OpenListingPanel | null = null;
const listeners = new Set<() => void>();

/**
 * Every listing *this document* has opened, and the row it was opened from.
 *
 * Serves two purposes, and the second is the load-bearing one. It supplies the preview row again
 * when a listing is re-reached by forward navigation, and — because it only ever contains listings
 * opened from within this document — it is how the popstate handler tells "back/forward across a
 * panel I opened" from "a `/listing/<id>` URL that belongs to the standalone route". Without that
 * distinction, landing back on a directly-loaded listing page would put this panel on screen on top
 * of the one `StandaloneListingView` is already rendering.
 */
const openedRows = new Map<string, ListingCardRow | undefined>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** The listing id in a `/listing/<id>` pathname, or null for any other route. */
export function listingIdFromPath(pathname: string): string | null {
  const match = /^\/listing\/([^/]+)\/?$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Opens the panel on `id` immediately, then moves the URL to match.
 *
 * Order matters. The store is set first so that React — which is inside a discrete event here, and
 * therefore commits before the browser paints — has the panel on screen in the same frame as the
 * click. The `pushState` after it is bookkeeping: it makes the open shareable, reloadable and
 * closable with the Back button, and it costs nothing because it is not a navigation.
 */
export function openListingPanel(id: string, row?: ListingCardRow): void {
  openedRows.set(id, row);
  openPanel = { id, row };
  emit();

  if (typeof window !== 'undefined' && window.location.pathname !== `/listing/${id}`) {
    window.history.pushState(null, '', `/listing/${id}`);
  }
}

/**
 * Closes by stepping back, rather than by clearing the store directly.
 *
 * The `pushState` on open put an entry in history, so going back is what actually undoes the open —
 * it restores the previous URL and lets the popstate handler below clear the panel. Clearing the
 * store here instead would leave the address bar on a listing whose panel had gone.
 */
export function closeListingPanel(): void {
  window.history.back();
}

/**
 * Brings the panel into line with the address bar, for browser Back and Forward.
 *
 * `openedRows` is the guard described above: a `/listing/<id>` URL only re-opens the panel if this
 * document is the thing that opened it in the first place.
 */
export function syncListingPanelToLocation(): void {
  const id = listingIdFromPath(window.location.pathname);
  const next = id !== null && openedRows.has(id) ? { id, row: openedRows.get(id) } : null;

  if (next?.id === openPanel?.id) return;

  openPanel = next;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The open listing, read directly.
 *
 * `useListingPanel` is this behind `useSyncExternalStore`; exported in its own right because the
 * store's contract — that an open is settled synchronously, with nothing awaited — is only
 * observable by reading it in the same tick as the call that set it.
 */
export function getListingPanel(): OpenListingPanel | null {
  return openPanel;
}

/**
 * The server always renders no panel.
 *
 * A soft open cannot exist during server rendering by definition, and the one route that *does*
 * render a listing on the server — `/listing/[id]` — renders it through `StandaloneListingView`
 * rather than through this store. Returning a constant keeps the two sides in agreement.
 */
function getServerSnapshot(): OpenListingPanel | null {
  return null;
}

export function useListingPanel(): OpenListingPanel | null {
  return useSyncExternalStore(subscribe, getListingPanel, getServerSnapshot);
}

/**
 * Drops all panel state. For tests, which share this module across cases.
 *
 * Deliberately leaves `listeners` alone: a subscriber is a mounted component, and dropping its
 * subscription here would leave it rendering a panel the store no longer knows about.
 */
export function resetListingPanel(): void {
  openPanel = null;
  openedRows.clear();
  emit();
}
