'use client';

import { useEffect, useRef, useState } from 'react';
import ListingCard from '@/components/ListingCard';
import ListingsMap from '@/components/ListingsMap';
import { useApp } from '@/lib/context';
import { listingIdFromPath } from '@/lib/listing-panel';

import type { SearchFilters } from '@/lib/types';
import SortDropdown from '@/components/SortDropdown';
import FilterModal, { countActiveFilters } from '@/components/FilterModal';
import {
  applyLandInterlock,
  parseFiltersFromSearchParams,
  parsePageFromSearchParams,
} from '@/lib/listing-filters';
import { useListingSearch } from '@/lib/useListingSearch';
import { ListingErrorState, ListingGridSkeleton } from '@/components/listing/ListingStates';

export interface SearchExperienceProps {
  /**
   * The query string to start from — e.g. `q=Bethesda%2C+MD`.
   *
   * On the search route this is the server's own `searchParams`, which is what makes the very first
   * render search for the right thing. It used to start empty and get filled in from
   * `window.location.search` after mount, so every load of a filtered URL fetched twice: once
   * nationwide, once for real.
   *
   * Behind a standalone listing it is the listing's city instead, because the URL there belongs to
   * the listing rather than to a search.
   */
  initialQuery?: string;
  /**
   * Whether this instance owns the browser URL: parses filters back out of it, follows history
   * events, and writes paging and sort into it.
   *
   * False behind an open listing modal — the URL there is the listing's, so reading it would yield
   * an unfiltered nationwide search and writing to it would overwrite the listing's own address.
   *
   * This used to be inferred from `initialQuery` being present, on the reasoning that the two
   * always travel together. They do not: closing a directly-loaded listing hands the URL *back* to
   * the search results already mounted behind it, which need to start owning it from that moment on
   * without remounting. That is exactly the case the inference could not express.
   */
  ownsUrl?: boolean;
  /**
   * Render the experience, but hold every request it would make.
   *
   * This exists because "do not compete with the listing panel for the network" and "do not leave a
   * hole where the page is" were being treated as the same requirement. The backdrop satisfied the
   * first by rendering `null` until two frames after hydration, which satisfied it by *not existing*
   * — so a directly-loaded listing went out with an empty body behind it, and the results appeared
   * later as a page popping into being rather than as content arriving. The user's description was
   * exact: the body disappears and reappears.
   *
   * They are different requirements and they now have different mechanisms. The shell — split
   * layout, results bar, map frame, card skeletons — is server-rendered and in the first HTML, so
   * the shape is there from the first paint. This flag is what keeps the *work* off the critical
   * path: no results fetch, no geocode, no map chunk, no tiles, until the caller clears it.
   *
   * Nothing about the rendered output is conditional on it, deliberately. A held search is
   * indistinguishable from an in-flight one — `status` stays `loading` and the map stays on its
   * placeholder — so clearing the flag is a continuation of a load already visibly underway, not a
   * second render of a different page.
   */
  deferred?: boolean;
}

/**
 * The search results experience: the split map/grid layout, its filters, sort and paging.
 *
 * This was `app/(with-search)/search/page.tsx` until the standalone listing page needed to render
 * the same experience behind its modal. A route file should not be imported from another route, so
 * the experience moved here and the route became a thin wrapper around it.
 */
export default function SearchExperience({
  initialQuery,
  ownsUrl = true,
  deferred = false,
}: SearchExperienceProps) {
  const { savedIds, setSearchLocation: setLocation, setSearchSuggestion } = useApp();

  /**
   * Follows the Back and Forward buttons, but only while this instance owns the URL.
   *
   * Separate from the seeding above because the two answer different questions, and merging them is
   * what made an `ownsUrl` flip destructive. Subscribing and unsubscribing is idempotent; re-seeding
   * is not.
   *
   * `popstate` is the only event worth listening for. This also listened for `pushstate` and
   * `replacestate`, which nothing in the app has ever dispatched — the same-page writes below use
   * the native History API directly, which fires no event, and Next.js does not synthesise one. They
   * were dead listeners, and their presence implied a notification path that does not exist.
   */
  useEffect(() => {
    if (typeof window === 'undefined' || !ownsUrl) return;

    const updateFromParams = () => {
      /*
       * A listing panel's URL is not a search, and must never be parsed as one.
       *
       * Forward-navigating back into an open panel lands here with `/listing/<id>` and an empty
       * query string, which would read as "no filters" and silently swap the user's results for an
       * unfiltered nationwide search sitting behind the panel — visible the moment they close it.
       * The panel is transient state over this page, so the right response is to leave the results
       * exactly as they are and wait for the pathname to come back.
       */
      if (listingIdFromPath(window.location.pathname) !== null) return;

      const params = new URLSearchParams(window.location.search);
      const q = params.get('q') || '';
      const lat = params.get('lat');
      const lon = params.get('lon');
      setLocation(q);
      if (q && lat && lon) {
        setSearchSuggestion({ display_name: q, lat, lon });
      } else if (!q) {
        setSearchSuggestion(null);
      }
      setFilters(parseFiltersFromSearchParams(params));
      setPage(parsePageFromSearchParams(params));
    };

    window.addEventListener('popstate', updateFromParams);
    return () => window.removeEventListener('popstate', updateFromParams);
  }, [ownsUrl, setLocation, setSearchSuggestion]);
  // Track hovered property for map highlight
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // Map center for search location (lat/lng)
  const [searchCenter, setSearchCenter] = useState<[number, number] | null>(null);
  // Boundary polygon GeoJSON for the searched area
  const [searchPolygon, setSearchPolygon] = useState<object | null>(null);

  // Ref for the split-layout container so we can measure its top position.
  // Used to compute --map-avail-h: the viewport height remaining below the
  // split layout's current top edge (= viewport height when sticking, less
  // when the in-page search bar is still visible at scroll ≈ 0).
  const splitRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Read the navbar height from the CSS custom property so JS and CSS
    // share a single source of truth (defined in globals.css as --navbar-h).
    const STICKY_TOP =
      parseInt(getComputedStyle(document.documentElement).getPropertyValue('--navbar-h'), 10) || 65;
    const MIN_MAP_H = 200; // px — floor so the map is never unusably short
    const update = () => {
      if (!splitRef.current) return;
      const { top } = splitRef.current.getBoundingClientRect();
      // Clamp to the sticky threshold so we never go negative when scrolled far
      const mapTop = Math.max(STICKY_TOP, top);
      const avail = window.innerHeight - mapTop;
      document.documentElement.style.setProperty(
        '--map-avail-h',
        `${Math.max(MIN_MAP_H, avail)}px`,
      );
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      document.documentElement.style.removeProperty('--map-avail-h');
    };
  }, []);

  /*
   * Filters state, seeded synchronously from `initialQuery` on the very first render.
   *
   * This is what stops a filtered URL from being fetched twice. It used to start `{}` on the search
   * route and be filled in by the effect above after mount, so the first render searched with no
   * filters at all: `/search?q=Alexandria,+VA` fired a nationwide query, then superseded it with
   * the real one a tick later — two full result sets fetched to display one.
   *
   * Seeding from a prop rather than from `window` is what makes it safe to do during server
   * rendering: both sides read the same string, so they agree about the active filter count.
   */
  const [filters, setFilters] = useState<SearchFilters>(() =>
    parseFiltersFromSearchParams(new URLSearchParams(initialQuery)),
  );
  // Two-phase geocode:
  //   Phase 1 — no polygon, ~300 bytes → sets map center immediately so tiles load fast
  //   Phase 2 — same query with polygon_geojson + aggressive simplification (~5-15 KB)
  //             fires in parallel to tile loading, boundary appears ~500ms later
  //
  // Keyed on the **committed** query — the `q` this instance was given — and deliberately not on
  // `location`, which is the search bar's live input value in shared app state and therefore changes
  // on every keystroke. Keying on it fired both phases per character: typing "Washington" issued 20
  // upstream requests, and Nominatim (1 req/s, absolute) answered `429` to all of them, which the
  // proxy surfaces as `502`. The bar then showed "No locations found" for a real city and the search
  // could not be run at all.
  //
  // This was latent until geocoding moved server-side. Called from the browser these requests were
  // blocked by CORS and never reached Nominatim, so an undebounced dependency cost nothing visible;
  // routing them through our own origin under an identifying `User-Agent` is what turned it into a
  // flood from a single egress IP. The committed query is also simply the correct key: the map
  // centres on the search that ran, exactly like the results do.
  const committedLocation = filters.query ?? '';
  useEffect(() => {
    // Clear stale state immediately so old boundary/center don't linger
    setSearchCenter(null);
    setSearchPolygon(null);
    if (deferred) return; // held: the map is on its placeholder, so there is nothing to centre yet
    if (!committedLocation.trim()) return;
    let cancelled = false;
    const location = committedLocation;
    const zip = (location.match(/\b(\d{5})\b/) ?? [])[1];

    /*
     * Both requests fire immediately — phase 1 just resolves first (no polygon payload).
     *
     * Through our own proxy, not `nominatim.openstreetmap.org` directly. Called from the browser
     * these were blocked by CORS, so the map never centred and never drew a boundary — four console
     * errors per search and no other symptom. They also tried to set a `User-Agent`, which a browser
     * silently drops, so they were anonymous to an upstream whose terms require identification. See
     * `app/api/_lib/nominatim.ts`.
     */
    const base = '/api/geocode?limit=1&addressdetails=0';
    const qParam = zip
      ? `postalcode=${zip}` // exact zip boundary, not the city that contains it
      : `q=${encodeURIComponent(location)}`;

    // Phase 1: center only
    const centerUrl = `${base}&${qParam}`;
    // Phase 2: same query + the boundary. `polygon=1` is the proxy's own flag; it applies the
    // vertex simplification too, so no caller can ask for the unsimplified geometry.
    const polyUrl = `${base}&${qParam}&polygon=1`;

    fetch(centerUrl)
      .then((r) => r.json())
      .then((data: Array<{ lat: string; lon: string }>) => {
        if (cancelled || !Array.isArray(data) || !data.length) return;
        setSearchCenter([parseFloat(data[0].lat), parseFloat(data[0].lon)]);
      })
      .catch(() => {
        if (!cancelled) setSearchCenter(null);
      });

    fetch(polyUrl)
      .then((r) => r.json())
      .then((data: Array<{ geojson?: { type: string }; boundingbox?: string[] }>) => {
        if (cancelled || !Array.isArray(data) || !data.length) {
          if (!cancelled) setSearchPolygon(null);
          return;
        }
        const geo = data[0].geojson;

        if (geo?.type === 'Polygon' || geo?.type === 'MultiPolygon') {
          // Real OSM boundary relation — use as-is (cities, counties, neighbourhoods)
          setSearchPolygon(geo as object);
        } else if (zip) {
          // Zip codes are synthetic points in OSM — fetch the real ZCTA polygon from
          // the US Census TIGER/Web service (proxied through our API to handle CORS).
          if (cancelled) return;
          fetch(`/api/zcta?zip=${zip}`)
            .then((r) => r.json())
            .then((fc: { features?: Array<{ geometry?: { type: string } }> }) => {
              if (cancelled) return;
              const geom = fc.features?.[0]?.geometry;
              if (geom?.type === 'Polygon' || geom?.type === 'MultiPolygon') {
                setSearchPolygon(geom as object);
              } else {
                setSearchPolygon(null);
              }
            })
            .catch(() => {
              if (!cancelled) setSearchPolygon(null);
            });
        } else {
          setSearchPolygon(null);
        }
      })
      .catch(() => {
        if (!cancelled) setSearchPolygon(null);
      });

    return () => {
      cancelled = true;
    };
  }, [committedLocation, deferred]);

  // Filter modal open state
  const [filterOpen, setFilterOpen] = useState(false);

  // Filter, sort and pagination are all enforced server-side now; the page holds only the
  // request. `total` and `pageCount` come from the response envelope rather than from the length
  // of the current page — which is the whole point of paging server-side.
  const [page, setPage] = useState(() =>
    parsePageFromSearchParams(new URLSearchParams(initialQuery)),
  );

  /**
   * Re-seeds everything derived from the URL whenever this instance is handed a different one.
   *
   * Placed after the state it seeds, and keyed on `initialQuery` alone — deliberately **not** on
   * `ownsUrl`.
   *
   * `ownsUrl` is a live value behind a standalone listing (`ListingSearchBackdrop` derives it from
   * whether a panel is open) and re-seeding on its flip throws away everything the user has done to
   * these results: sort and paging reset to the listing's original city query, two extra
   * `/api/listings` requests per open, and modal filters lost outright because only `page` and
   * `sort` are ever written to the URL. `initialQuery` does not change on that flip, so keying on it
   * alone keeps that fixed while still following a genuinely new query.
   *
   * **Filters and page must be re-seeded here, not only in their `useState` initialisers.** Next
   * does not remount a segment when only its search parameters change — `createRouterCacheKey`
   * excludes them by design — so `router.push('/search?q=…')` from the search bar re-renders this
   * same instance with a new `initialQuery` prop and no initialiser runs again. Seeding the location
   * but not the filters moved the search bar and the map to the new city while the grid, the result
   * count and the request all stayed on the old one: searching a new city appeared to do nothing.
   * Verified against a live service — Alexandria → Washington, DC left "1 result / Old Town,
   * Alexandria" on screen and issued no request at all, because `useListingSearch` keys on the
   * filters' value and that value had not changed.
   *
   * Re-seeding on mount is a no-op rather than a double fetch: the values parse from the same string
   * the initialisers used, so `useListingSearch`'s value-derived key is unchanged and nothing
   * refetches.
   *
   * Held instances skip it outright. `setLocation` and `setSearchSuggestion` are shared app state —
   * the header's search bar reads them — so a shell rendered purely to hold the layout's shape
   * would otherwise blank the bar it is sitting under.
   */
  useEffect(() => {
    if (typeof window === 'undefined' || deferred) return;

    const params = new URLSearchParams(initialQuery);
    const q = params.get('q') || '';
    const lat = params.get('lat');
    const lon = params.get('lon');
    setLocation(q);
    // Restore the suggestion object so CompactSearchBar can search again without re-typing
    if (q && lat && lon) {
      setSearchSuggestion({ display_name: q, lat, lon });
    } else if (!q) {
      setSearchSuggestion(null);
    }
    setFilters(parseFiltersFromSearchParams(params));
    setPage(parsePageFromSearchParams(params));
  }, [initialQuery, deferred, setLocation, setSearchSuggestion]);

  const { results, total, pageCount, status, error, retry } = useListingSearch(
    filters,
    page,
    !deferred,
  );

  const isLoading = status === 'loading';
  const isError = status === 'error';

  /** Keeps the URL the shareable source of truth for the current result set. */
  const pushPage = (next: number) => {
    setPage(next);
    if (!ownsUrl) return; // not our URL to write — see `ownsUrl`
    const params = new URLSearchParams(window.location.search);
    if (next === 1) params.delete('page');
    else params.set('page', String(next));
    const qs = params.toString();
    window.history.pushState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
  };

  return (
    <div className="flex flex-col">
      {/* Filter modal */}
      <FilterModal
        isOpen={filterOpen}
        onClose={() => setFilterOpen(false)}
        filters={filters}
        onChange={(f) => {
          // A parcel has no bedrooms, bathrooms or living area, and dwelling predicates exclude
          // parcels server-side — so a stale `beds` alongside the Lot/Land chip would return an
          // unexplained zero. The values are cleared here, not dropped from the request.
          setFilters(applyLandInterlock(f));
          pushPage(1);
        }}
        resultCount={total}
      />

      {/* Body: Airbnb-style split layout.
           Desktop  — map fills right half edge-to-edge, full viewport height.
           Mobile   — map is sticky behind property cards; white rounded card
                      slides up over the map as the user scrolls (Airbnb feel).
           Technique: on mobile the map column is `position:absolute` spanning
           the full parent height, which gives `position:sticky` a tall enough
           parent to remain pinned while cards scroll over it. */}
      <div ref={splitRef} className="relative flex flex-col md:flex-row">
        {/* ── Map column ────────────────────────────────────────────────────
            Mobile  : absolute, fills parent so sticky has room to hold.
            Desktop : normal right-half column, edge-to-edge (no padding). ── */}
        <div
          className="absolute inset-0 z-0
                     md:relative md:inset-auto md:order-last md:w-[52%]"
        >
          <div className="sticky top-[65px] h-[45vh] search-map-sticky md:py-6 md:pl-3 md:pr-10 lg:pl-5 lg:pr-20">
            <ListingsMap
              listings={results}
              savedIds={savedIds}
              activeId={hoveredId}
              // Sizing only. The radius used to be asserted here as `md:rounded-2xl` and had no
              // effect — an inline style inside the map overrode it at every breakpoint — so the
              // panel has always been 28px. It stays 28px, defined once in `map-panel.ts`.
              className="h-full w-full"
              searchCenter={searchCenter}
              searchPolygon={searchPolygon}
              active={!deferred}
            />
          </div>
        </div>

        {/* ── Properties column ─────────────────────────────────────────────
            Mobile  : margin-top pushes it just below the map with a 2 rem
                      overlap; rounded white sheet slides over map on scroll.
            Desktop : left half, horizontal padding mirrors the toolbar. ── */}
        <div
          className="relative z-10 mt-[calc(45vh-2rem)]
                     rounded-t-3xl bg-white shadow-[0_-8px_30px_rgba(0,0,0,0.10)]
                     md:order-first md:w-[48%] md:mt-0 md:rounded-none
                     md:shadow-none md:z-auto
                     md:pb-6 md:pl-10 md:pr-3 lg:pl-20 lg:pr-5"
        >
          {/* Drag handle — visible on mobile only */}
          <div className="flex justify-center pt-3 pb-1 md:hidden" aria-hidden="true">
            <div className="h-1 w-10 rounded-full bg-gray-300" />
          </div>

          {/* Slim sticky bar */}
          <div className="search-results-bar sticky top-[65px] z-20 bg-white flex items-center justify-between gap-3 px-5 py-2 md:px-0 border-b border-surface-border mb-6">
            <p className="text-sm text-ink-muted" aria-live="polite">
              {isLoading ? (
                <span className="inline-block h-4 w-24 animate-pulse rounded-xs bg-surface-soft align-middle" />
              ) : isError ? (
                <span className="text-ink">Results unavailable</span>
              ) : (
                <>
                  <span className="font-semibold text-ink">{total.toLocaleString()}</span>{' '}
                  {total === 1 ? 'result' : 'results'}
                </>
              )}
            </p>
            <div className="flex items-center gap-4 relative">
              <button
                onClick={() => setFilterOpen(true)}
                className="bg-transparent px-0 py-0.5 text-sm font-semibold transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 cursor-pointer text-ink flex items-center gap-1.5"
                aria-label="Open filters"
              >
                <svg
                  width="18"
                  height="20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  viewBox="0 0 24 24"
                  className="shrink-0 text-ink-muted self-center"
                  aria-hidden="true"
                >
                  <circle cx="17" cy="5" r="2" />
                  <circle cx="7" cy="12" r="2" />
                  <circle cx="17" cy="19" r="2" />
                  <line x1="3" y1="5" x2="15" y2="5" />
                  <line x1="9" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="19" x2="15" y2="19" />
                </svg>
                Filters
                {countActiveFilters(filters) > 0 && (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ink text-[11px] font-bold text-white">
                    {countActiveFilters(filters)}
                  </span>
                )}
              </button>
              <SortDropdown
                value={filters.sort || 'recommended'}
                onChange={(v) => {
                  if (!v) return;
                  setFilters((prev) => ({ ...prev, sort: v }));
                  setPage(1);
                  if (!ownsUrl) return; // not our URL to write — see `ownsUrl`
                  const params = new URLSearchParams(window.location.search);
                  params.set('sort', String(v));
                  params.delete('page');
                  window.history.pushState(
                    {},
                    '',
                    `${window.location.pathname}?${params.toString()}`,
                  );
                }}
              />
            </div>
          </div>

          <div className="px-5 pb-10 md:px-0 md:pb-0">
            {isLoading ? (
              <ListingGridSkeleton count={6} />
            ) : isError ? (
              /*
               * A failed search is not "no homes match". The API rejects some filter combinations
               * with a 400 and can be unavailable entirely; both must read as a problem the user
               * can respond to rather than as an empty result set.
               */
              <ListingErrorState
                message={error ?? 'We could not load listings just now. Please try again.'}
                onRetry={retry}
              />
            ) : results.length === 0 ? (
              <EmptyState onClear={() => window.location.reload()} />
            ) : (
              <>
                <div className="grid gap-8 gap-y-12 grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3">
                  {results.map((l) => (
                    <div
                      key={l.id}
                      onMouseEnter={() => setHoveredId(l.id)}
                      onMouseLeave={() => setHoveredId(null)}
                    >
                      <ListingCard listing={l} />
                    </div>
                  ))}
                </div>
                {pageCount > 1 && (
                  <div className="flex justify-center mt-10">
                    <nav className="inline-flex items-center gap-1 rounded-full bg-white/90 px-4 py-2 shadow-lg border border-surface-border">
                      <button
                        className="px-3 py-1.5 rounded-full font-semibold text-ink-muted hover:text-ink disabled:opacity-40"
                        onClick={() => pushPage(Math.max(1, page - 1))}
                        disabled={page === 1}
                        aria-label="Previous page"
                      >
                        &lt;
                      </button>
                      {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) =>
                        p === 1 || p === pageCount || Math.abs(p - page) <= 2 ? (
                          <button
                            key={p}
                            className={`px-3 py-1.5 rounded-full font-semibold transition ${
                              p === page
                                ? 'bg-ink text-white shadow'
                                : 'text-ink-muted hover:text-ink'
                            }`}
                            onClick={() => pushPage(p)}
                            aria-current={p === page ? 'page' : undefined}
                          >
                            {p}
                          </button>
                        ) : (p === page - 3 || p === page + 3) && pageCount > 7 ? (
                          <span key={p} className="px-2 text-ink-muted">
                            …
                          </span>
                        ) : null,
                      )}
                      <button
                        className="px-3 py-1.5 rounded-full font-semibold text-ink-muted hover:text-ink disabled:opacity-40"
                        onClick={() => pushPage(Math.min(pageCount, page + 1))}
                        disabled={page === pageCount}
                        aria-label="Next page"
                      >
                        &gt;
                      </button>
                    </nav>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onClear }: { onClear: () => void }) {
  return (
    <div className="rounded-3xl border border-dashed border-surface-border bg-surface-alt/60 py-20 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm">
        <svg
          className="h-7 w-7 text-ink-muted"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
      </div>
      <p className="mt-5 font-display text-xl font-bold">No homes match your filters</p>
      <p className="mt-1 text-sm text-ink-muted">
        Try widening your price range or removing a filter.
      </p>
      <button onClick={onClear} className="btn-primary mt-5 text-sm">
        Clear all filters
      </button>
    </div>
  );
}
