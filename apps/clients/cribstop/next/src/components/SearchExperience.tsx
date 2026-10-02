'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import ListingCard from '@/components/ListingCard';
import ListingsMap from '@/components/ListingsMap';
import type { NeighborhoodBounds } from '@/components/ListingsMapInner';
import { useApp } from '@/lib/context';
import { listingIdFromPath } from '@/lib/listing-panel';

import type { SearchFilters } from '@/lib/types';
import type { SearchSuggestionValue } from '@/lib/store/types';
import ToolbarSelect, {
  TOOLBAR_BUTTON_CLASS,
  TOOLBAR_LABEL_CLASS,
  type ToolbarOption,
} from '@/components/ToolbarSelect';
import ResultsPager from '@/components/ResultsPager';
import NeighborhoodGroupGrid, {
  NeighborhoodGroupGridSkeleton,
} from '@/components/NeighborhoodGroupGrid';
import FilterModal, { countActiveFilters } from '@/components/FilterModal';
import {
  applyLandInterlock,
  filtersToSearchParams,
  parseFiltersFromSearchParams,
  parsePageFromSearchParams,
} from '@/lib/listing-filters';
import { maxReachablePage, type NeighborhoodRow } from '@cribstop/property-contracts';
import { useListingSearch } from '@/lib/useListingSearch';
import { useNeighborhoodGroups } from '@/lib/useNeighborhoodGroups';
import {
  backToGroupFilters,
  drillDownFilters,
  GROUP_PAGE_SIZE,
  type GroupBy,
  type GroupOrder,
  type GroupState,
  parseGroupState,
  scopeToken,
  writeGroupState,
} from '@/lib/group-by';
import { usableFitBounds } from '@/lib/neighborhoods';
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
  /**
   * The place a search path names (#350). Its filters go into every request, but never into the
   * query string and never into the applied-filter count: the path already says them.
   */
  place?: SearchPathPlace;
}

export interface SearchPathPlace {
  /** Location filters and the listing type the path implies. */
  filters: SearchFilters;
  /** Search bar label, for example "Del Ray, Alexandria, VA". Empty for a map-area search. */
  label: string;
  /** Seeds the search bar's selected suggestion. */
  suggestion?: SearchSuggestionValue | null;
  /** Query parameters that belong to the path and survive a filter change (`type=all`). */
  query?: string;
}

/** Filters from the query string. On a search path, `type` belongs to the place, not the filters. */
function parseQueryFilters(params: URLSearchParams, place: SearchPathPlace | undefined) {
  if (!place) return parseFiltersFromSearchParams(params);
  const own = new URLSearchParams(params);
  own.delete('type');
  own.delete('listingType');
  return parseFiltersFromSearchParams(own);
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
  place,
}: SearchExperienceProps) {
  const {
    savedIds,
    setSearchLocation: setLocation,
    setSearchSuggestion,
    setSearchListingType,
  } = useApp();

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

      seedFromParams(new URLSearchParams(window.location.search));
    };

    window.addEventListener('popstate', updateFromParams);
    return () => window.removeEventListener('popstate', updateFromParams);
  }, [ownsUrl, place, setLocation, setSearchSuggestion, setSearchListingType]);
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
    parseQueryFilters(new URLSearchParams(initialQuery), place),
  );
  /** The request: the query-string filters plus whatever the path names. */
  const requestFilters = useMemo(
    () => (place ? { ...filters, ...place.filters } : filters),
    [filters, place],
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
  const committedLocation = filters.query ?? place?.label ?? '';
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

  /** "Group by" and the group order (#502). URL state, but not a filter and never counted as one. */
  const [group, setGroup] = useState<GroupState>(() =>
    parseGroupState(new URLSearchParams(initialQuery)),
  );

  /** The card or marker the pointer or focus is on, by `NeighborhoodRow.key` (#503). */
  const [activeGroupKey, setActiveGroupKey] = useState<string | null>(null);
  /** Where the map fits after a drill-down (#503). Null when the row has no bounds. */
  const [focus, setFocus] = useState<{
    name: string;
    city?: string;
    state?: string;
    bounds: NeighborhoodBounds;
  } | null>(null);

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
  function seedFromParams(params: URLSearchParams) {
    const q = params.get('q') || place?.label || '';
    const lat = params.get('lat');
    const lon = params.get('lon');
    setLocation(q);
    // Restore the suggestion object so CompactSearchBar can search again without re-typing
    if (place?.suggestion) {
      setSearchSuggestion(place.suggestion);
    } else if (q && lat && lon) {
      setSearchSuggestion({ display_name: q, lat, lon });
    } else if (!q) {
      setSearchSuggestion(null);
    }
    const parsedFilters = parseQueryFilters(params, place);
    setFilters(parsedFilters);
    setPage(parsePageFromSearchParams(params));
    setGroup(parseGroupState(params));
    // Keeps the search bar's "What" summary equal to the listing type the results apply, so that a
    // new search from the bar does not drop it (#243 review).
    setSearchListingType((place ? place.filters.listingType : parsedFilters.listingType) ?? 'all');
  }

  useEffect(() => {
    if (typeof window === 'undefined' || deferred) return;
    seedFromParams(new URLSearchParams(initialQuery));
  }, [initialQuery, place, deferred, setLocation, setSearchSuggestion, setSearchListingType]);

  /** Writes a query string for this path, with the path's own parameters kept. */
  const writeUrl = (params: URLSearchParams) => {
    new URLSearchParams(place?.query).forEach((value, key) => params.set(key, value));
    const qs = params.toString();
    window.history.pushState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
  };

  const grouped = group.groupBy === 'neighborhood';

  // In the grouped view `page` pages the neighborhood cards. The listing search still runs, on page
  // 1, because the filter modal reads its total. The map shows one marker per card (#503).
  const { results, total, pageCount, pageSize, status, error, errorCode, retry } = useListingSearch(
    requestFilters,
    grouped ? 1 : page,
    !deferred,
  );

  const groups = useNeighborhoodGroups(requestFilters, page, group.order, grouped && !deferred);

  const isLoading = status === 'loading';
  const isError = status === 'error';

  /**
   * How many pages the pager may offer, as opposed to how many pages of results exist (#65).
   *
   * The API bounds paging depth: `(page - 1) * pageSize` may not exceed `MAX_RESULT_OFFSET`, and a
   * request past that is a 400. `pageCount` is derived from the exact `total` and is deliberately
   * NOT clamped to the window — it is the honest size of the result set, and the headline count
   * above still renders from `total`. But a page button the API will refuse is a button that
   * breaks when clicked, so the pager is bounded here and only here.
   *
   * The bound is computed from the page size the API actually APPLIED (echoed in the envelope),
   * never from an assumed one: because the limit is on the offset, the deepest reachable page
   * changes with page size, so a clamp keyed on a separately-declared constant silently stops
   * matching the moment the request's page size is tuned.
   *
   * This also stops `Array.from({ length: pageCount })` below from allocating one element per page
   * of the full dataset — fine at a few hundred seeded rows, a five-figure array per render once a
   * real IDX feed is behind the endpoint.
   */
  const reachablePageCount = Math.min(pageCount, maxReachablePage(pageSize));

  /**
   * True once the result set is bigger than the pager can reach — rare now that
   * `MAX_RESULT_OFFSET` (#368) covers a large city's full for-sale count, but still possible for an
   * unfiltered, nationwide browse.
   *
   * The headline count above stays honest (`total`, uncapped). This flag only gates the note under
   * the pager that explains the gap between the two, matching how Zillow/Redfin handle the same
   * depth cap: cap it, but say so, rather than let a "page 501 of 501" pager look complete against
   * a headline that reads a bigger count.
   */
  const isPagerCapped = pageCount > reachablePageCount;

  /**
   * The highest row the pager can actually reach, for the capped-results note.
   *
   * `reachablePageCount * pageSize`, never a formula built from `MAX_RESULT_OFFSET` directly:
   * the reachable row count only equals `MAX_RESULT_OFFSET + pageSize` when `pageSize` evenly
   * divides `MAX_RESULT_OFFSET`, which the hardcoded default (20) does but an arbitrary echoed
   * `pageSize` need not. Deriving it from `reachablePageCount` — the same value the pager itself
   * is built from — is what keeps the note and the last page button agreeing by construction.
   * Never above `total`: a search whose `total` sits just past the window should not claim more
   * rows are reachable than exist.
   */
  const reachableResultCount = Math.min(reachablePageCount * pageSize, total);

  /**
   * A search that failed because it asked to page past the window is not a failed load (#65). The
   * request is well-formed and the service is healthy; it will answer the same way forever, so the
   * generic error state's "Try again" is a button that cannot work — and the pager, which lives in
   * the results branch, is not rendered to offer a way back. Reachable by hand-editing `?page=`, by
   * an old bookmark, or by a link minted before this bound existed.
   */
  const isPastWindow = errorCode === 'result_window_exceeded';

  /** Keeps the URL the shareable source of truth for the current result set. */
  const pushPage = (next: number) => {
    setPage(next);
    if (!ownsUrl) return; // not our URL to write — see `ownsUrl`
    const params = new URLSearchParams(window.location.search);
    if (next === 1) params.delete('page');
    else params.set('page', String(next));
    writeUrl(params);
  };

  /**
   * Commits a filter set: state, URL and paging together.
   *
   * **The URL is written, not just the state.** Filters used to live only in this component, so a
   * narrowed search could not be refreshed, bookmarked or sent to anyone — reloading the page
   * silently returned a different, wider result set than the one on screen. `?q=` was shareable and
   * nothing else was.
   *
   * **Paging resets to page 1.** A filter change is a different result set, and the user's position
   * in the old one is not a position in the new one: applying a filter from page 40 of a broad
   * search lands past the end of a narrow one. That reads as an empty page at best, and once the
   * API's result window is in play (#65, `result_window_exceeded`) as an outright error on a
   * request the user never made.
   *
   * The interlock runs here rather than at the call sites so every entry path — the modal, the
   * empty state's clear, anything added later — goes through it once.
   */
  const applyFilters = (next: SearchFilters) => {
    const committed = applyLandInterlock(next);
    setFilters(committed);
    setPage(1);
    if (!ownsUrl) return; // not our URL to write — see `ownsUrl`
    writeUrl(filtersToSearchParams(committed, new URLSearchParams(window.location.search)));
  };

  /**
   * What "Clear all filters" clears: the filters, and only the filters.
   *
   * The place searched for and the requested order are the search bar's and the sort control's,
   * not the filter panel's — dropping `q` would turn "show me more homes in Bethesda" into a
   * nationwide search, which is not what the button offers. This used to call
   * `window.location.reload()`, which reloaded the same filtered URL and therefore cleared
   * nothing at all.
   */
  const clearFilters = () => {
    const { query, zip, street, city, state, neighborhood, boundary, sort } = filters;
    applyFilters({ query, zip, street, city, state, neighborhood, boundary, sort });
  };

  /** Commits a filter set and a group state together: state, URL and paging (#502). */
  const commitView = (nextFilters: SearchFilters, nextGroup: GroupState) => {
    const committed = applyLandInterlock(nextFilters);
    setFilters(committed);
    setGroup(nextGroup);
    setPage(1);
    if (!ownsUrl) return; // not our URL to write — see `ownsUrl`
    const params = filtersToSearchParams(committed, new URLSearchParams(window.location.search));
    writeUrl(writeGroupState(params, nextGroup));
  };

  /** Shows one neighborhood's listings: group-by off, the neighborhood on, scoped by city and state. */
  const drillInto = (row: NeighborhoodRow, listingType?: 'sale' | 'rent') => {
    // On a search path the path owns the listing type, so a count link changes the path.
    if (place && listingType && pathHoldsType()) {
      window.location.assign(drillHref(row, listingType));
      return;
    }
    const fit = usableFitBounds(row);
    setFocus(fit ? { name: row.name, city: row.city, state: row.state, bounds: fit } : null);
    setActiveGroupKey(null);
    commitView(drillDownFilters(filters, row, listingType), {
      ...group,
      groupBy: undefined,
      from: scopeToken(filters, pathType),
    });
  };

  const pathHoldsType = () =>
    typeof window !== 'undefined' &&
    /^\/homes-for-(sale|rent)(\/|$)/.test(window.location.pathname);

  /** The listing type the current search path shows, or undefined off a search path. */
  const pathType = place
    ? /(^|&)type=all(&|$)/.test(place.query ?? '')
      ? 'all'
      : (place.filters.listingType ?? 'all')
    : undefined;

  const backToGroups = () => {
    setFocus(null);
    const backFilters = backToGroupFilters(filters, group.from);
    const backGroup: GroupState = { ...group, groupBy: 'neighborhood', from: undefined };
    // A count link may have moved the search to the other path. Return to the path it left.
    const origType = group.from?.split('|')[2];
    if (place && origType && origType !== pathType && pathHoldsType()) {
      const params = filtersToSearchParams(
        backFilters,
        new URLSearchParams(window.location.search),
      );
      writeGroupState(params, backGroup);
      params.delete('type');
      if (origType === 'all') params.set('type', 'all');
      const path = window.location.pathname.replace(
        /^\/homes-for-(sale|rent)/,
        `/homes-for-${origType === 'rent' ? 'rent' : 'sale'}`,
      );
      window.location.assign(`${path}?${params.toString()}`);
      return;
    }
    commitView(backFilters, backGroup);
  };

  /** The URL a card opens, for a new tab or a copied link. A plain click runs `drillInto`. */
  const drillHref = (row: NeighborhoodRow, listingType?: 'sale' | 'rent') => {
    const base = new URLSearchParams(
      typeof window === 'undefined' ? initialQuery : window.location.search,
    );
    const swapPath = Boolean(place && listingType && pathHoldsType());
    const params = filtersToSearchParams(drillDownFilters(filters, row, listingType), base);
    writeGroupState(params, { ...group, groupBy: undefined, from: scopeToken(filters, pathType) });
    if (swapPath) {
      // The new path implies the type, and a `type` override would undo it.
      params.delete('type');
    } else {
      new URLSearchParams(place?.query).forEach((value, key) => params.set(key, value));
    }
    const qs = params.toString();
    let path = typeof window === 'undefined' ? '' : window.location.pathname;
    if (swapPath) {
      path = path.replace(
        /^\/homes-for-(sale|rent)/,
        `/homes-for-${listingType === 'rent' ? 'rent' : 'sale'}`,
      );
    }
    return `${path}${qs ? `?${qs}` : ''}`;
  };

  /** Touch: a first tap on a marker brings its card into view. */
  const scrollToGroupCard = (key: string) => {
    const card = Array.from(document.querySelectorAll<HTMLElement>('[data-neighborhood-key]')).find(
      (el) => el.dataset.neighborhoodKey === key,
    );
    card?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  const groupPageCount = Math.ceil(groups.total / GROUP_PAGE_SIZE);
  const reachableGroupPages = Math.min(groupPageCount, maxReachablePage(GROUP_PAGE_SIZE));
  const isGroupsLoading = groups.status === 'loading';
  const isGroupsError = groups.status === 'error';

  return (
    <div className="flex flex-col">
      {/* Filter modal — mounted only while open, so its draft is seeded from the applied filters
           on every open rather than once, at page mount. See the note on `FilterModal`. */}
      {filterOpen && (
        <FilterModal
          onClose={() => setFilterOpen(false)}
          filters={filters}
          onChange={applyFilters}
          resultCount={total}
        />
      )}

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
              filters={requestFilters}
              total={total}
              neighborhoods={
                grouped
                  ? {
                      rows: groups.rows,
                      activeKey: activeGroupKey,
                      onActive: setActiveGroupKey,
                      onSelect: drillInto,
                      onTapPreview: scrollToGroupCard,
                    }
                  : undefined
              }
              focusBounds={
                !grouped &&
                focus &&
                filters.neighborhood === focus.name &&
                filters.city === focus.city &&
                filters.state === focus.state
                  ? focus.bounds
                  : null
              }
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
          <div className="search-results-bar sticky top-[65px] z-20 bg-white flex flex-wrap items-center justify-between gap-x-3 px-5 py-2 md:px-0 border-b border-surface-border mb-6">
            <p className="text-sm text-ink-muted" aria-live="polite">
              {(grouped ? isGroupsLoading : isLoading) ? (
                <span className="inline-block h-4 w-24 animate-pulse rounded-xs bg-surface-soft align-middle" />
              ) : (grouped ? isGroupsError : isError) ? (
                <span className="text-ink">Results unavailable</span>
              ) : grouped ? (
                <>
                  <span className="font-semibold text-ink">{groups.total.toLocaleString()}</span>{' '}
                  {groups.total === 1 ? 'neighborhood' : 'neighborhoods'}
                </>
              ) : (
                <>
                  <span className="font-semibold text-ink">{total.toLocaleString()}</span>{' '}
                  {total === 1 ? 'home' : 'homes'}
                </>
              )}
            </p>
            <div className="flex flex-wrap items-center justify-end gap-x-4 relative">
              <button
                onClick={() => setFilterOpen(true)}
                className={TOOLBAR_BUTTON_CLASS}
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
                <span className={TOOLBAR_LABEL_CLASS}>Filters</span>
                {countActiveFilters(filters) > 0 && (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ink text-[11px] font-bold text-white">
                    {countActiveFilters(filters)}
                  </span>
                )}
              </button>
              <ToolbarSelect<GroupBy | 'none'>
                label="Group by"
                testId="group-by-control"
                value={group.groupBy ?? 'none'}
                options={GROUP_BY_OPTIONS}
                icon={GROUP_ICON}
                onChange={(v) => {
                  if (v === 'neighborhood' && filters.neighborhood) backToGroups();
                  else
                    commitView(filters, {
                      ...group,
                      groupBy: v === 'none' ? undefined : v,
                      from: undefined,
                    });
                }}
              />
              {grouped ? (
                <ToolbarSelect<GroupOrder>
                  label="Sort"
                  testId="group-order-control"
                  value={group.order}
                  options={GROUP_ORDER_OPTIONS}
                  icon={SORT_ICON}
                  onChange={(order) => {
                    setGroup((prev) => ({ ...prev, order }));
                    setPage(1);
                    if (!ownsUrl) return; // not our URL to write — see `ownsUrl`
                    const params = new URLSearchParams(window.location.search);
                    params.delete('page');
                    writeUrl(writeGroupState(params, { ...group, order }));
                  }}
                />
              ) : (
                <ToolbarSelect<SortValue>
                  label="Sort"
                  testId="sort-control"
                  options={SORT_OPTIONS}
                  icon={SORT_ICON}
                  value={(filters.sort || 'recommended') as SortValue}
                  onChange={(v) => {
                    setFilters((prev) => ({ ...prev, sort: v }));
                    setPage(1);
                    if (!ownsUrl) return; // not our URL to write — see `ownsUrl`
                    const params = new URLSearchParams(window.location.search);
                    params.set('sort', String(v));
                    params.delete('page');
                    writeUrl(params);
                  }}
                />
              )}
            </div>
          </div>

          <div className="px-5 pb-10 md:px-0 md:pb-0">
            {!grouped && filters.neighborhood && (
              <button
                type="button"
                data-testid="back-to-neighborhoods"
                onClick={backToGroups}
                className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <span aria-hidden="true">&larr;</span>
                All neighborhoods
              </button>
            )}
            {grouped ? (
              isGroupsLoading ? (
                <NeighborhoodGroupGridSkeleton />
              ) : isGroupsError ? (
                <ListingErrorState
                  message={
                    groups.error ?? 'We could not load neighborhoods just now. Please try again.'
                  }
                  onRetry={groups.retry}
                />
              ) : groups.rows.length === 0 ? (
                <div
                  role="status"
                  data-testid="neighborhood-group-empty"
                  className="rounded-3xl border border-dashed border-surface-border bg-surface-alt/60 px-4 py-16 text-center"
                >
                  <p className="font-display text-xl font-bold">No neighborhoods match</p>
                  <p className="mt-1 text-sm text-ink-muted">
                    Your search ran and found no neighborhoods for these filters. Try removing a
                    filter or set Group by to None to see the homes.
                  </p>
                </div>
              ) : (
                <>
                  <NeighborhoodGroupGrid
                    rows={groups.rows}
                    hrefFor={drillHref}
                    onSelect={drillInto}
                    activeKey={activeGroupKey}
                    onActive={setActiveGroupKey}
                  />
                  <ResultsPager page={page} pageCount={reachableGroupPages} onPage={pushPage} />
                  {groupPageCount > reachableGroupPages && (
                    <p className="mt-4 text-center text-xs text-ink-muted" role="status">
                      Showing the first {(reachableGroupPages * GROUP_PAGE_SIZE).toLocaleString()}{' '}
                      of {groups.total.toLocaleString()} neighborhoods. Narrow your filters to see
                      more.
                    </p>
                  )}
                </>
              )
            ) : isLoading ? (
              <ListingGridSkeleton count={6} />
            ) : isError ? (
              /*
               * A failed search is not "no homes match". The API rejects some filter combinations
               * with a 400 and can be unavailable entirely; both must read as a problem the user
               * can respond to rather than as an empty result set.
               */
              <ListingErrorState
                message={error ?? 'We could not load listings just now. Please try again.'}
                heading={isPastWindow ? 'That is past the last page of results' : undefined}
                actionLabel={isPastWindow ? 'Back to the first page' : undefined}
                onRetry={isPastWindow ? () => pushPage(1) : retry}
              />
            ) : results.length === 0 ? (
              /*
               * Three outcomes, three visibly different surfaces — skeleton cards while loading,
               * a red-flagged alert when the API failed, and this. A search that legitimately
               * matches nothing must not read as a broken site, and it must not be mistaken for
               * either of the other two: it says which filters are narrowing, and offers the one
               * action that widens them.
               */
              <EmptyState activeFilterCount={countActiveFilters(filters)} onClear={clearFilters} />
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
                <ResultsPager page={page} pageCount={reachablePageCount} onPage={pushPage} />
                {isPagerCapped && (
                  <p className="mt-4 text-center text-xs text-ink-muted" role="status">
                    Showing the first {reachableResultCount.toLocaleString()} of{' '}
                    {total.toLocaleString()} homes. Narrow your filters or zoom the map to see more.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

type SortValue = NonNullable<SearchFilters['sort']>;

// #391. "Newest" means the listing itself is new to the market, matching Zillow/Redfin, not the
// last time the feed touched the record, which is what the API's own `newest` sort orders by. The
// API keeps `newest` for that modification-time case. This control never offers it.
const SORT_OPTIONS: ToolbarOption<SortValue>[] = [
  { value: 'recommended', label: 'Recommended' },
  { value: 'price-desc', label: 'Highest price' },
  { value: 'price-asc', label: 'Lowest price' },
  { value: 'newly-listed', label: 'Newest' },
];

const GROUP_BY_OPTIONS: { value: GroupBy | 'none'; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'neighborhood', label: 'Neighborhood' },
];

const GROUP_ORDER_OPTIONS: { value: GroupOrder; label: string }[] = [
  { value: 'count', label: 'Most homes' },
  { value: 'name', label: 'Name A-Z' },
];

const ICON_PROPS = {
  width: 18,
  height: 20,
  fill: 'none',
  viewBox: '0 0 24 24',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

const GROUP_ICON = (
  <svg {...ICON_PROPS}>
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
  </svg>
);

const SORT_ICON = (
  <svg {...ICON_PROPS}>
    <path d="m3 18 4 4 4-4" />
    <path d="M7 22V2" />
    <path d="m21 6-4-4-4 4" />
    <path d="M17 2v20" />
  </svg>
);

function EmptyState({
  activeFilterCount,
  onClear,
}: {
  activeFilterCount: number;
  onClear: () => void;
}) {
  const filtered = activeFilterCount > 0;
  return (
    <div
      role="status"
      data-testid="search-empty-state"
      className="rounded-3xl border border-dashed border-surface-border bg-surface-alt/60 py-20 text-center"
    >
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
      <p className="mt-5 font-display text-xl font-bold">
        {filtered ? 'No homes match your filters' : 'No homes to show here'}
      </p>
      <p className="mt-1 text-sm text-ink-muted">
        {filtered
          ? `Your search ran, and ${activeFilterCount === 1 ? 'the filter you applied matches' : `the ${activeFilterCount} filters you applied match`} no listings. Try widening your price range or removing a filter.`
          : 'Your search ran and found no listings in this area. Try searching a nearby city or ZIP code.'}
      </p>
      {filtered && (
        <button onClick={onClear} className="btn-primary mt-5 text-sm">
          Clear all filters
        </button>
      )}
    </div>
  );
}
