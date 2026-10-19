'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type {
  HomeFeedResponse,
  NeighborhoodRow as NeighborhoodApiRow,
  PropertyType,
} from '@cribstop/property-contracts';
import { useApp } from '@/lib/context';
import { listRecentSavedHomes } from '@/lib/api/saved-homes';
import ListingRow from '@/components/ListingRow';
import NeighborhoodRow, { type Neighborhood } from '@/components/NeighborhoodRow';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { searchKeys } from '@/lib/query/keys';
import {
  listingsMetaOptions,
  neighborhoodsOptions,
  searchResultsOptions,
} from '@/lib/query/search';
import type { ListingSearchQuery } from '@/lib/api/listings';
import type { ListingCardRow, ListingsMeta } from '@/lib/types';
import { searchTargetUrl } from '@/lib/search-place';
import { formatRelativeTime } from '@/lib/format';
import { homeTargetDebugEnabled, type InferredTarget, prefersRentFirst } from '@/lib/home-target';
import { isPersonalisationEnabled, readItems } from '@/lib/feed-profile';
import { useHomeTarget } from '@/lib/useHomeTarget';
import { feedRowTitle, type HomeFeedFlags } from '@/lib/home-feed';
import { useHomeFeed } from '@/lib/useHomeFeed';
import {
  CAROUSEL_PAGE_SIZE,
  DEFAULT_PRICE_SORT,
  homeBatchId,
  HomeBatchProvider,
  homeRowQuery,
  PRICE_FLOOR,
  type PriceSort,
  SALE_HOME_TYPES,
  useHomeBatchRow,
} from '@/lib/home-batch';
import Link from 'next/link';
import { BRAND } from '@/lib/brand';
import {
  addNeighborhoodRows,
  NEIGHBORHOODS_MIN_COUNT,
  neighborhoodsHref,
} from '@/lib/neighborhoods';

/** The one distinction this page ever browses by. Never `'all'`/`'sold'` — #398 always shows both
 *  sale and rent, each as its own section. */
type ListingSide = 'sale' | 'rent';

/** A row left with fewer cards than this after the drop keeps its original cards. */
const MIN_DEDUPED_CARDS = 4;
/** Cards a row shows before "See all". */
const ROW_MAX = 7;

type ShownEntry = { side: ListingSide; order: number; ids: string[] };
type ShownRegistry = {
  shown: Record<string, ShownEntry>;
  report: (rowKey: string, entry: ShownEntry | null) => void;
};
const ShownContext = createContext<ShownRegistry | null>(null);

/** Records which cards each resolved row shows. A row reads only rows that come earlier on the
 *  page, so no row waits for another row's request. */
function ShownProvider({ children }: { children: React.ReactNode }) {
  const [shown, setShown] = useState<Record<string, ShownEntry>>({});
  const report = useCallback((rowKey: string, entry: ShownEntry | null) => {
    setShown((current) => {
      const before = current[rowKey];
      if (!entry) {
        if (!before) return current;
        const { [rowKey]: _removed, ...rest } = current;
        return rest;
      }
      if (before && before.order === entry.order && before.ids.join() === entry.ids.join()) {
        return current;
      }
      return { ...current, [rowKey]: entry };
    });
  }, []);
  const value = useMemo(() => ({ shown, report }), [shown, report]);
  return <ShownContext.Provider value={value}>{children}</ShownContext.Provider>;
}

/** Page order of the rows that dedupe. The earlier row keeps a card, the later row skips it. */
const DEDUPE_ORDER = { nearYou: 0, justListed: 1, priceDrops: 2 } as const;

/**
 * Drops cards an earlier row on the page already shows. Until that row resolves nothing drops, so
 * a later row may show a repeat for a moment, then filters once. If the drop leaves fewer than
 * `MIN_DEDUPED_CARDS`, the row keeps its original cards.
 */
function useDedupedListings(
  rowKey: string,
  side: ListingSide,
  order: number,
  listings: ListingCardRow[],
  loading: boolean,
): ListingCardRow[] {
  const registry = useContext(ShownContext);
  const shown = registry?.shown;
  const report = registry?.report;

  const deduped = useMemo(() => {
    if (!shown) return listings;
    const earlier = new Set<string>();
    for (const [key, entry] of Object.entries(shown)) {
      if (key !== rowKey && entry.side === side && entry.order < order) {
        entry.ids.forEach((id) => earlier.add(id));
      }
    }
    if (earlier.size === 0) return listings;
    const kept = listings.filter((l) => !earlier.has(l.propertyId));
    return kept.length >= MIN_DEDUPED_CARDS ? kept : listings;
  }, [shown, rowKey, side, order, listings]);

  const idsKey = deduped
    .slice(0, ROW_MAX)
    .map((l) => l.propertyId)
    .join('|');
  useEffect(() => {
    if (!report) return;
    report(rowKey, loading ? null : { side, order, ids: idsKey ? idsKey.split('|') : [] });
  }, [report, rowKey, side, order, loading, idsKey]);
  useEffect(() => () => report?.(rowKey, null), [report, rowKey]);

  return deduped;
}

/**
 * The recent-search storage `CompactSearchBar` already writes (`recentSearches`). #398 reuses this
 * key rather than adding one: an entry now carries the listing type active at the time of that
 * search, so the newest entry says which side the visitor searched last. One read/parse shared by
 * `lastSearchedSide` and `lastSearchedPlace` (#416), so a corrupted-value fix or a stored-shape
 * change lands once, not in two near-identical functions.
 */
function latestRecentSearch(): any {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem('recentSearches');
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? (parsed[0] ?? null) : null;
  } catch {
    return null;
  }
}

/** Only `'rent'` flips the order; a last search of `'sale'`, `'all'`, `'sold'`, or none at all
 *  all fall to the "otherwise sale first" branch below. */
function lastSearchedSide(): ListingSide | null {
  return latestRecentSearch()?.listingType === 'rent' ? 'rent' : null;
}

/** True once the client has read a rent last search, or mostly rent views in 7 days. `false` until
 *  then (and forever if there is none) — server render always sees no history. */
function useRentFirst(): boolean {
  const [rentFirst, setRentFirst] = useState(false);
  useEffect(() => {
    const views = isPersonalisationEnabled()
      ? readItems()
          .filter((i) => i.kind === 'view')
          .map((i) => ({ side: i.side, at: i.at }))
      : [];
    setRentFirst(prefersRentFirst({ lastSearchSide: lastSearchedSide(), views }));
  }, []);
  return rentFirst;
}

/** A place a row scopes to. `InferredTarget` adds the source, confidence and radius (`lib/home-target.ts`). */
type Region = { city: string; state: string };

/** Logs which source a row used. Off unless the debug flag is set. */
function useTargetDebug(row: string, target: InferredTarget | null) {
  useEffect(() => {
    if (!target || !homeTargetDebugEnabled()) return;
    console.info(
      `[home-target] ${row}: ${target.source} ${target.city}, ${target.state} C=${target.confidence.toFixed(2)} r=${target.radiusKm ?? 'state'}`,
    );
  }, [row, target]);
}

type CarouselState = {
  listings: ListingCardRow[];
  total: number;
  loading: boolean;
  /** true once the fetch has settled with an error — shows retry UI instead of blank. */
  failed: boolean;
  /** The serialized query that produced a settled result. A caller compares it to its current
   *  query, so a result left over from an earlier query never reads as the answer to a new one. */
  settledKey?: string;
};

/**
 * Fetches one carousel's rows against the live Property API.
 *
 * Each carousel owns its own request and its own state, so one failing (or slow) fetch never
 * blocks or blanks the others — they render in parallel because each is an independent effect
 * fired on mount / whenever `query` changes, not a chain of awaits.
 */
function useCarouselListings(
  query: ListingSearchQuery,
  skip = false,
  skipLoading = false,
  batchId?: string,
) {
  // #960. A row with a batch id reads the one home request. It runs its own search only when
  // no batch answers for it.
  const batch = useHomeBatchRow(skip ? undefined : batchId);
  // #755. A row shows a handful of cards and never pages, so it skips the exact match count.
  // `total` then holds the number of cards returned, which is all the rows below read.
  // No previous data is kept: old cards never stay under a new place title.
  const result = useQuery({
    ...searchResultsOptions({ ...query, skipTotal: true }, { keepPrevious: false }),
    enabled: !skip && batch === null,
  });
  const { refetch } = result;
  const retry = useCallback(() => {
    if (batch?.kind === 'failed') batch.refetch();
    else void refetch();
  }, [refetch, batch]);

  // No place to scope to (#363's near-you row, before the region resolves or once it resolves to
  // none): never fires an unscoped, platform-wide request. `skipLoading` tells the two `skip`
  // cases apart: still waiting on the region (show the skeleton) versus resolved with no region
  // at all (settle empty so the row hides).
  let state: CarouselState;
  if (skip) {
    state = { listings: [], total: 0, loading: skipLoading, failed: false };
  } else if (batch) {
    state =
      batch.kind === 'pending'
        ? { listings: [], total: 0, loading: true, failed: false }
        : batch.kind === 'failed'
          ? { listings: [], total: 0, loading: false, failed: true }
          : {
              listings: batch.result.results,
              total: batch.result.total,
              loading: false,
              failed: false,
              settledKey: JSON.stringify(query),
            };
  } else if (result.isError && !result.data) {
    // A failed refetch keeps the last good cards (#955). Only a row with nothing to show fails.
    state = { listings: [], total: 0, loading: false, failed: true };
  } else if (result.data) {
    state = {
      listings: result.data.results,
      total: result.data.total,
      loading: false,
      failed: false,
      settledKey: JSON.stringify(query),
    };
  } else {
    state = { listings: [], total: 0, loading: true, failed: false };
  }
  return {
    ...state,
    refetch: retry,
    batchScope: batch?.kind === 'ready' ? batch.scope : undefined,
  };
}

/** The place a target row queries: the city, then the whole state, then nowhere (platform-wide). */
type CarouselScope = { city?: string; state?: string };

/** The search params that carry a row's place into its "View all" link. */
function scopeParams(scope: CarouselScope): Record<string, string> {
  return {
    ...(scope.city ? { city: scope.city } : {}),
    ...(scope.state ? { state: scope.state } : {}),
  };
}

/**
 * A row scoped to the home target (#873). While the target resolves, the row waits and sends no
 * query. With a target it queries the city, then the state, then platform-wide, each only when the
 * one before returned nothing, so a row never hides while wider results exist. With no target at
 * all it queries platform-wide. `scope` names the place that filled the row, for "View all".
 */
function useTargetCarousel(
  base: ListingSearchQuery,
  place: InferredTarget | null,
  placeLoading: boolean,
  batchId?: string,
) {
  // #960. A batched row never widens here: the server widened it and reports the place it used.
  const batched = useHomeBatchRow(placeLoading ? undefined : batchId) !== null;
  const placeKey = place ? `${place.city}|${place.state}` : '';
  const [fallback, setFallback] = useState({ placeKey, step: 0 });
  const step = batched ? 0 : fallback.placeKey === placeKey ? fallback.step : 0;
  const stepScope: CarouselScope = !place
    ? {}
    : step === 0
      ? { city: place.city, state: place.state }
      : step === 1
        ? { state: place.state }
        : {};
  const query = { ...base, ...stepScope };
  const result = useCarouselListings(query, placeLoading, placeLoading, batchId);
  const scope: CarouselScope = result.batchScope ?? stepScope;
  // A failed query does not widen. The row shows its retry for that step.
  const empty =
    !placeLoading &&
    !result.loading &&
    !result.failed &&
    result.total === 0 &&
    result.settledKey === JSON.stringify(query);
  const widening = !batched && empty && place !== null && step < 2;

  useEffect(() => {
    if (widening) setFallback({ placeKey, step: step + 1 });
  }, [widening, placeKey, step]);

  // A moved target starts over. Without this, a return to an earlier place would resume its old step.
  useEffect(() => {
    setFallback((f) => (f.placeKey === placeKey ? f : { placeKey, step: 0 }));
  }, [placeKey]);

  // A result for an earlier step is not the answer to this step's query yet: keep the skeleton.
  const stale = !placeLoading && !result.failed && result.settledKey !== JSON.stringify(query);
  return { ...result, loading: result.loading || widening || stale, scope };
}

/** Tiles shown before the horizontal scroll takes over (#393). */
const NEIGHBORHOODS_TARGET = 8;
/** Per-request paging, matching the row's own display cap. */
const NEIGHBORHOODS_PAGE_SIZE = 24;
type NeighborhoodsState = {
  neighborhoods: Neighborhood[];
  loading: boolean;
};

/**
 * Fetches "Explore neighborhoods" tiles: the visitor's own region first (city+state, then state
 * alone), then one request per licensed state, then — only if that has not already filled the
 * row — one request with no state filter for whatever else the data holds (#363, #393).
 *
 * Waits for the region fetch to settle (`regionLoading`) before firing anything, so this runs
 * once per page load rather than once with no region and again once it resolves.
 *
 * The per-state requests fire together, not one after another: each is independent, and the merge
 * order comes from `BRAND.licensedStateCodes` itself, never from which response lands first. Within
 * a state the API's own order applies (`total` desc), so this adds no ranking of its own.
 */
function useNeighborhoods(region: Region | null, regionLoading: boolean): NeighborhoodsState {
  const client = useQueryClient();
  // Primitives, never the `region` object: the caller rebuilds it on every render (#915).
  const city = region?.city;
  const state = region?.state;
  const { data, isPending } = useQuery({
    queryKey: [...searchKeys.neighborhoods('home'), city ?? '', state ?? ''],
    enabled: !regionLoading,
    queryFn: async ({ signal }) => {
      const seen = new Set<string>();
      const merged: Neighborhood[] = [];
      const add = (rows: NeighborhoodApiRow[]) => addNeighborhoodRows(rows, seen, merged);
      // Each request has its own cache entry, shared with the search page's group reads.
      const read = (query: Parameters<typeof neighborhoodsOptions>[0]) =>
        client.fetchQuery(neighborhoodsOptions(query));

      // The visitor's own region, city+state then state alone, ahead of every licensed-state
      // request — so a visitor's own city and state render first even when their state isn't a
      // licensed one.
      if (city && state) {
        const settledRegion = await Promise.allSettled([
          read({
            city,
            state,
            limit: NEIGHBORHOODS_PAGE_SIZE,
            minCount: NEIGHBORHOODS_MIN_COUNT,
          }),
          read({
            state,
            limit: NEIGHBORHOODS_PAGE_SIZE,
            minCount: NEIGHBORHOODS_MIN_COUNT,
          }),
        ]);
        for (const result of settledRegion) {
          if (result.status === 'fulfilled' && result.value) add(result.value.results);
        }
      }

      if (signal.aborted) return merged;

      // `allSettled`, not `all`: one licensed state's request failing must not blank the others'
      // already-good results. Order is the input order regardless of which settles first.
      const settled = await Promise.allSettled(
        BRAND.licensedStateCodes.map((code) =>
          read({ state: code, limit: NEIGHBORHOODS_PAGE_SIZE, minCount: NEIGHBORHOODS_MIN_COUNT }),
        ),
      );
      for (const result of settled) {
        if (result.status === 'fulfilled' && result.value) add(result.value.results);
      }

      if (signal.aborted) return merged;

      if (merged.length < NEIGHBORHOODS_TARGET) {
        const licensed = new Set<string>(BRAND.licensedStateCodes);
        try {
          const rest = await read({
            limit: NEIGHBORHOODS_PAGE_SIZE,
            minCount: NEIGHBORHOODS_MIN_COUNT,
          });
          if (rest) add(rest.results.filter((row) => !licensed.has(row.state)));
        } catch {
          // The row still shows whatever the licensed-state requests already collected.
        }
      }
      return merged;
    },
  });

  return { neighborhoods: data ?? [], loading: regionLoading || isPending };
}

/**
 * "Explore neighborhoods" (#393): replaces the fixed eight-name list and its stock photos with the
 * real neighborhood counts from `GET /listings/neighborhoods` (#390). A plain geographic tile
 * carries the same navigational value as the old photo card, with no popularity framing (PRD
 * §6.3) and no place URL that 404s on a name Nominatim has never heard of (`lib/place-resolve.ts`).
 */
function ExploreNeighborhoodsRow({
  region,
  regionLoading,
}: {
  region: Region | null;
  regionLoading: boolean;
}) {
  const { neighborhoods, loading } = useNeighborhoods(region, regionLoading);

  return (
    <NeighborhoodRow
      title="Explore neighborhoods"
      href={neighborhoodsHref(region)}
      neighborhoods={neighborhoods}
      loading={loading}
    />
  );
}

/**
 * The dataset's own freshness facts, for the trust block.
 *
 * Fetched independently of every carousel below: a filtered search envelope's `total` would make
 * "Homes listed" mean "listings matching whatever the last carousel asked for", and its own
 * `dataUpdatedAt` isn't returned at all. `null` means "not known" and the affected tile is
 * omitted — never a fallback number or today's date (PRD §6.3).
 */
function useListingsMeta(): ListingsMeta | null {
  // A failure leaves `data` empty. Chrome, not a task: the affected tiles simply don't render.
  const { data } = useQuery(listingsMetaOptions());
  return data ?? null;
}

/**
 * Builds a plain search href for a row with no place — reuses the search bar's own URL builder
 * (`searchTargetUrl`) so the segment, the `type=all` override and the extra query merge exactly
 * the way every other search link on the site does, rather than a second implementation of it.
 */
function searchHref(side: ListingSide, params: Record<string, string>): string {
  return searchTargetUrl(
    { kind: 'area', params: new URLSearchParams() },
    side,
    new URLSearchParams(params),
  );
}

/** "Newest homes for sale" / "Newest rentals" (#394): a true list date, not
 *  `ModificationTimestamp`. Sorts by `newly-listed` with no date cutoff, so the row always fills.
 *  Hidden while empty and settled. No subtitle: the title states what the row shows on its own. */
const JUST_LISTED_TITLE: Record<ListingSide, string> = {
  sale: 'Newest homes for sale',
  rent: 'Newest rentals',
};

function JustListedRow({
  side,
  place,
  placeLoading,
}: {
  side: ListingSide;
  place: InferredTarget | null;
  placeLoading: boolean;
}) {
  useTargetDebug(`just-listed-${side}`, place);
  const carousel = useTargetCarousel(
    homeRowQuery.justListed(side),
    place,
    placeLoading,
    homeBatchId.justListed(side),
  );
  const { total, loading, failed, refetch, scope } = carousel;
  const listings = useDedupedListings(
    `just-listed-${side}`,
    side,
    DEDUPE_ORDER.justListed,
    carousel.listings,
    loading,
  );

  const show = loading || total > 0 || failed;
  if (!show) return null;

  return (
    <ListingRow
      title={JUST_LISTED_TITLE[side]}
      targetSource={place?.source}
      href={searchHref(side, { sort: 'newly-listed', ...scopeParams(scope) })}
      listings={listings}
      loading={loading}
      failed={failed}
      onRetry={refetch}
      max={7}
      sectionClassName="px-6 pt-3 sm:px-10 lg:px-20"
    />
  );
}

/** "Homes for sale near you" / "Rentals near you" (#363): the AGENTS.md title rule bans a
 *  place named in a title from IP/geolocation, so the region scopes the query only — the title
 *  never names the city. */
const NEAR_YOU_TITLE: Record<ListingSide, string> = {
  sale: 'Homes for sale near you',
  rent: 'Rentals near you',
};

/** The cold-start market (#834) is not the visitor's place, so its row does not say "near you". */
const MARKET_TITLE: Record<ListingSide, string> = {
  sale: 'Homes for sale',
  rent: 'Rentals',
};

/** "Near you" (#363): the home page's first row. One stable component throughout — its query
 *  goes from skipped to region-scoped in place, rather than swapping in a freshly-mounted child
 *  once the region resolves. Hidden while the region is unknown or absent, and while it resolves
 *  to a place with no matching listings — no fallback city, no error UI, no browser geolocation
 *  prompt. */
function NearYouRow({
  side,
  region,
  regionLoading,
}: {
  side: ListingSide;
  region: InferredTarget | null;
  regionLoading: boolean;
}) {
  useTargetDebug(`near-you-${side}`, region);
  const near = useCarouselListings(
    homeRowQuery.nearYou(side, region),
    regionLoading || !region,
    regionLoading,
    homeBatchId.nearYou(side),
  );
  const { total, loading } = near;
  const listings = useDedupedListings(
    `near-you-${side}`,
    side,
    DEDUPE_ORDER.nearYou,
    near.listings,
    loading,
  );

  // No error UI (#363): a failed fetch hides the row exactly like a real zero total, rather than
  // showing a retry card scoped to a place the visitor never entered themselves.
  if (!loading && total === 0) return null;

  return (
    <ListingRow
      title={region?.source === 'rotation' ? MARKET_TITLE[side] : NEAR_YOU_TITLE[side]}
      targetSource={region?.source}
      href={
        region
          ? searchTargetUrl(
              { kind: 'place', place: { kind: 'city', city: region.city, state: region.state } },
              side,
            )
          : undefined
      }
      listings={listings}
      loading={loading}
      max={7}
      sectionClassName="px-6 pt-3 sm:px-10 lg:px-20"
    />
  );
}

/** The newest saves to read for the latest one that still has a listing. An off-market home has
 *  no listing type to query by, so one read of a few covers it without a second call. */
const SAVED_LOOKBACK = 5;

type LatestSave = {
  city: string;
  state: string;
  propertyType: PropertyType;
  listingType: ListingSide;
};

/**
 * The most recent saved home that has a listing, read once while signed in (#364). Signed out
 * never calls the API. A failed read leaves `null`, so the row hides and never blanks the page.
 */
function useLatestSave(accountKey: string | null): { save: LatestSave | null; loading: boolean } {
  const [state, setState] = useState<{ save: LatestSave | null; loading: boolean }>({
    save: null,
    loading: accountKey !== null,
  });

  useEffect(() => {
    if (!accountKey) {
      setState({ save: null, loading: false });
      return undefined;
    }
    setState({ save: null, loading: true });
    const controller = new AbortController();
    listRecentSavedHomes(SAVED_LOOKBACK, controller.signal)
      .then((homes) => {
        // A sold home has no side to browse by, so the latest rent or sale save wins.
        const card = homes.find(
          (h) => h.listing?.city && h.listing.state && h.listing.listingType !== 'sold',
        )?.listing;
        setState({
          loading: false,
          save: card
            ? {
                city: card.city,
                state: card.state,
                propertyType: card.propertyType,
                listingType: card.listingType === 'rent' ? 'rent' : 'sale',
              }
            : null,
        });
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        // The row stays hidden. Log a real failure so a broken endpoint is visible.
        console.warn('Saved homes row: read failed', err);
        setState({ save: null, loading: false });
      });
    return () => controller.abort();
  }, [accountKey]);

  return state;
}

/** "More homes in {city}" (#364): follows the latest save, not the intent control.
 *  Hidden with no save, no matching listings, or a failed fetch. The copy states the reason only. */
function SavedLikeRow({
  save,
  saveLoading,
  savedPropertyIds,
}: {
  save: LatestSave | null;
  saveLoading: boolean;
  savedPropertyIds: Set<string>;
}) {
  const {
    listings,
    total,
    loading: searching,
  } = useCarouselListings(
    {
      city: save?.city,
      state: save?.state,
      propertyType: save ? [save.propertyType] : undefined,
      listingType: save?.listingType,
      pageSize: CAROUSEL_PAGE_SIZE,
    },
    !save,
    saveLoading,
  );
  const loading = saveLoading || searching;

  // The search contract has no exclude filter, so already-saved homes drop out here.
  const visible = listings.filter((l) => !savedPropertyIds.has(l.propertyId));
  if (!loading && (!save || total === 0 || visible.length === 0)) return null;

  return (
    <ListingRow
      // The saved read has not settled yet, so no city exists. The skeleton shows the generic title.
      title={save ? `More homes in ${save.city}` : 'More homes like the ones you saved'}
      targetSource={save ? 'saved-home' : undefined}
      href={
        save
          ? searchTargetUrl(
              { kind: 'place', place: { kind: 'city', city: save.city, state: save.state } },
              save.listingType,
              new URLSearchParams({ propertyType: save.propertyType }),
            )
          : undefined
      }
      listings={visible}
      loading={loading}
      max={7}
      sectionClassName="px-6 pt-3 sm:px-10 lg:px-20"
    />
  );
}

/**
 * Per-side "coming soon" copy (#416, #418): a short, concrete call to action — the good feeling
 * of being first, without claiming exclusivity the product doesn't have. "Be the first to see"
 * means "before the general market listing", never "before other visitors": Coming Soon listings
 * are public to every visitor (PRD §6.3, no unbacked claim).
 */
const COMING_SOON_TITLE: Record<ListingSide, string> = {
  sale: 'Be first to see homes coming for sale',
  rent: "See new rentals before they're listed",
};

/** "Coming soon" (#392): listed early, showings not started. Hidden while empty and settled. */
function ComingSoonRow({
  side,
  place,
  placeLoading,
}: {
  side: ListingSide;
  place: InferredTarget | null;
  placeLoading: boolean;
}) {
  useTargetDebug(`coming-soon-${side}`, place);
  // Scoped to the home target even with no subtitle to name it. While the target resolves, the
  // row waits. With no target at all, it shows the platform-wide row.
  const { listings, total, loading, failed, refetch } = useCarouselListings(
    homeRowQuery.comingSoon(side, place),
    placeLoading,
    placeLoading,
    homeBatchId.comingSoon(side),
  );

  const show = loading || total > 0 || failed;
  if (!show) return null;

  return (
    <ListingRow
      title={COMING_SOON_TITLE[side]}
      targetSource={place?.source}
      href={searchHref(side, {
        status: 'Coming Soon',
        ...(place ? { city: place.city, state: place.state } : {}),
      })}
      listings={listings}
      loading={loading}
      failed={failed}
      onRetry={refetch}
      max={7}
      sectionClassName="px-6 pt-3 sm:px-10 lg:px-20"
    />
  );
}

/** "Price drops on homes for sale" (#394): a real price-cut flag — the title never claims a
 *  savings amount or percentage (no deal claim). Sale only, matching the ticket's scope. */
function PriceDropsRow({
  place,
  placeLoading,
}: {
  place: InferredTarget | null;
  placeLoading: boolean;
}) {
  useTargetDebug('price-drops', place);
  const carousel = useTargetCarousel(
    homeRowQuery.priceDrops(),
    place,
    placeLoading,
    homeBatchId.priceDrops,
  );
  const { total, loading, failed, refetch, scope } = carousel;
  const listings = useDedupedListings(
    'price-drops',
    'sale',
    DEDUPE_ORDER.priceDrops,
    carousel.listings,
    loading,
  );

  const show = loading || total > 0 || failed;
  if (!show) return null;

  return (
    <ListingRow
      title="Price drops on homes for sale"
      targetSource={place?.source}
      href={searchHref('sale', { priceReduced: 'true', ...scopeParams(scope) })}
      listings={listings}
      loading={loading}
      failed={failed}
      onRetry={refetch}
      max={7}
      sectionClassName="px-6 pt-3 sm:px-10 lg:px-20"
    />
  );
}

/** Titles describe price only (Fair Housing). "Cheapest"/"Priciest" name the sort, never a place. */
const PRICE_SORT_TITLE: Record<ListingSide, Record<PriceSort, string>> = {
  sale: { 'price-asc': 'Cheapest homes for sale', 'price-desc': 'Priciest homes for sale' },
  rent: { 'price-asc': 'Cheapest rentals', 'price-desc': 'Priciest rentals' },
};

const PRICE_SORT_OPTIONS: { value: PriceSort; label: string }[] = [
  { value: 'price-asc', label: 'Lowest' },
  { value: 'price-desc', label: 'Highest' },
];

/**
 * Two-segment pill beside a row title. The active segment uses the app's one selected-chip style
 * (`FilterModalContent`'s Home Type chips): black fill, not a brand color (#398).
 */
function PriceSortToggle({
  value,
  onChange,
}: {
  value: PriceSort;
  onChange: (sort: PriceSort) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Sort by price"
      className="inline-flex shrink-0 whitespace-nowrap rounded-full border border-surface-border bg-white p-px"
    >
      {PRICE_SORT_OPTIONS.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`relative inline-flex h-5 items-center justify-center whitespace-nowrap rounded-full px-2 text-[11px] font-semibold leading-none transition before:absolute before:-inset-y-3 before:inset-x-0 before:content-['']  focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 ${
              active ? 'bg-ink text-white' : 'text-ink hover:bg-surface-alt'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * "Cheapest homes for sale" / "Priciest rentals" (#478): a pure price sort with no price cap, so
 * the row never empties because of one. The toggle re-queries this one carousel. A seller-withheld
 * price sorts last in both directions and the floor drops it, so it never shows. Scoped to the
 * home target, like the other rows.
 */
function PriceSortRow({
  side,
  place,
  placeLoading,
}: {
  side: ListingSide;
  place: InferredTarget | null;
  placeLoading: boolean;
}) {
  const [sort, setSort] = useState<PriceSort>(DEFAULT_PRICE_SORT);
  useTargetDebug(`price-sort-${side}`, place);

  // The batch carries the default sort. Another sort is a click, so it runs its own search.
  const { listings, total, loading, failed, refetch } = useCarouselListings(
    homeRowQuery.priceSort(side, sort, place),
    placeLoading,
    placeLoading,
    sort === DEFAULT_PRICE_SORT ? homeBatchId.priceSort(side) : undefined,
  );

  if (!loading && !failed && total === 0) return null;

  return (
    <ListingRow
      title={PRICE_SORT_TITLE[side][sort]}
      targetSource={place?.source}
      // "See all" carries the same floor and types, so the search page matches the row.
      href={searchHref(side, {
        sort,
        minPrice: String(PRICE_FLOOR[side]),
        ...(side === 'sale' ? { propertyType: SALE_HOME_TYPES.join(',') } : {}),
        ...(place ? { city: place.city, state: place.state } : {}),
      })}
      listings={listings}
      loading={loading}
      failed={failed}
      onRetry={refetch}
      max={7}
      sectionClassName="px-6 pt-3 sm:px-10 lg:px-20"
      titleClassName="min-w-0 truncate font-display text-lg font-semibold tracking-tight sm:text-xl lg:text-[22px]"
      headerExtra={<PriceSortToggle value={sort} onChange={setSort} />}
    />
  );
}

/**
 * The brokerage trust block (#392, #419): facts only — no unsourced claims (PRD §6.3). The title
 * states the one fact `lastUpdated` backs; it never names "MLS" or "IDX" (#418: consumer-facing
 * jargon). When freshness isn't known yet, the title falls back to a plain claim it can still
 * back, rather than a fabricated time.
 */
function TrustBlock() {
  const meta = useListingsMeta();
  // #438. "Updated X ago" means the last successful MLS sync, not the newest feed timestamp among
  // listings — a listing's own `dataUpdatedAt` can be older than the run that fetched it.
  // `lastSyncedAt` is absent on an older deployment and `null` before any run has succeeded, so
  // both fall back to `dataUpdatedAt` rather than hiding the tile.
  const freshness = meta ? (meta.lastSyncedAt ?? meta.dataUpdatedAt) : null;
  const lastUpdated = freshness != null ? formatRelativeTime(freshness) : null;
  const title = lastUpdated ? `Real listings, updated ${lastUpdated}` : 'Real, licensed listings';

  return (
    <section className="mt-10 px-6 pb-10 sm:px-10 lg:px-20">
      <div className="overflow-hidden rounded-xl bg-surface-alt text-ink border border-surface-border">
        <div className="grid gap-8 px-8 py-12 sm:grid-cols-[1.4fr_1fr] sm:items-center sm:px-12 sm:py-16 lg:px-16">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-900">
              {BRAND.brokerageShort}
            </p>
            <h2 className="mt-3 font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
              {title}
            </h2>
            <p className="mt-4 text-base leading-relaxed text-ink/80">
              {BRAND.siteName} is brokered by {BRAND.brokerageShort}, licensed in{' '}
              {BRAND.licensedStates}.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/about"
                className="inline-flex items-center justify-center rounded-full bg-brand-50 px-5 py-2.5 text-sm font-semibold text-brand-900 transition hover:bg-brand-100 hover:text-brand-900"
              >
                Learn more
              </Link>
              <Link
                href="/homes-for-sale?type=all"
                className="inline-flex items-center justify-center rounded-full border border-brand-200 px-5 py-2.5 text-sm font-semibold text-brand-900 transition hover:bg-brand-50 hover:text-brand-900"
              >
                Browse homes
              </Link>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-6 sm:gap-8">
            {meta && (
              <div>
                <dt className="font-display text-3xl font-extrabold sm:text-4xl">
                  {meta.listingCount.toLocaleString()}
                </dt>
                <dd className="mt-1 text-xs uppercase tracking-wider text-ink/60">
                  {meta.listingCount === 1 ? 'Home listed' : 'Homes listed'}
                </dd>
              </div>
            )}
            <div>
              <dt className="font-display text-3xl font-extrabold sm:text-4xl">
                {BRAND.licensedStateCodes.length}
              </dt>
              <dd className="mt-1 text-xs uppercase tracking-wider text-ink/60">States licensed</dd>
            </div>
            {lastUpdated && (
              <div>
                <dt className="font-display text-lg font-extrabold sm:text-xl">{lastUpdated}</dt>
                <dd className="mt-1 text-xs uppercase tracking-wider text-ink/60">Updated</dd>
              </div>
            )}
          </dl>
        </div>
      </div>
    </section>
  );
}

/** Rows in the feed skeleton. A typical warm feed has this many rows above the price-sort rows. */
const FEED_SKELETON_ROWS = 3;

/** Card-row placeholders. Same row component and padding as real rows, with an empty title line. */
function FeedSkeleton() {
  return (
    <div aria-hidden="true" data-testid="home-feed-skeleton">
      {Array.from({ length: FEED_SKELETON_ROWS }, (_, i) => (
        <ListingRow
          key={i}
          title={' '}
          listings={[]}
          loading
          max={7}
          sectionClassName="px-6 pt-3 sm:px-10 lg:px-20"
        />
      ))}
    </div>
  );
}

/**
 * The ranked rows (#836). A row sets `feed`, so each card sends `feed_impression` and
 * `feed_click` with the row, position, variant and model version. The title is the server's. It
 * names only a place the visitor chose or acted on (`titleSafeTarget`).
 */
function FeedRows({ feed }: { feed: HomeFeedResponse }) {
  return (
    <>
      {feed.rows
        .filter((row) => row.listings.length > 0)
        .map((row) => (
          <ListingRow
            key={row.rowId}
            title={feedRowTitle(row.rowId, row.title)}
            rowId={row.rowId}
            listings={row.listings.map((item) => item.listing)}
            exploreIds={new Set(row.listings.filter((i) => i.explore).map((i) => i.listing.id))}
            feed={{ variant: row.variant, modelVersion: row.modelVersion }}
            max={8}
            sectionClassName="px-6 pt-3 sm:px-10 lg:px-20"
          />
        ))}
    </>
  );
}

/**
 * Row order (#394 stakeholder ruling, #363): "Near you" leads the body, sale then rent — the
 * first row a visitor sees is scoped to their own region, not a platform-wide feed. Just listed
 * (sale), Coming soon (sale) and Price drops are sale rows; "Rentals" is its own two-row cluster
 * (just listed, then coming soon) that normally follows Price drops. When the visitor's last
 * search was rent, both the "Near you" pair and the rentals cluster move up — `useRentFirst` is
 * the only thing that changes; nothing about the rows themselves does.
 */
export default function HomePageContent({ homeFeed }: { homeFeed?: HomeFeedFlags }) {
  const rentFirst = useRentFirst();
  const { user, savedPropertyIds } = useApp();
  const { save: latestSave, loading: saveLoading } = useLatestSave(user?.email ?? null);
  const { target: region, loading: regionLoading } = useHomeTarget({
    signedIn: !!user,
    savedHome: latestSave ? { city: latestSave.city, state: latestSave.state } : null,
    savedPending: saveLoading,
  });
  const feedState = useHomeFeed(homeFeed, region, regionLoading, rentFirst ? 'rent' : 'sale');
  const savedLike = user ? (
    <SavedLikeRow
      key="saved-like"
      save={latestSave}
      saveLoading={saveLoading}
      savedPropertyIds={savedPropertyIds}
    />
  ) : null;

  const nearYouSale = (
    <NearYouRow key="near-you-sale" side="sale" region={region} regionLoading={regionLoading} />
  );
  const nearYouRent = (
    <NearYouRow key="near-you-rent" side="rent" region={region} regionLoading={regionLoading} />
  );
  const justListedSale = (
    <JustListedRow key="just-listed-sale" side="sale" place={region} placeLoading={regionLoading} />
  );
  const comingSoonSale = (
    <ComingSoonRow key="coming-soon-sale" side="sale" place={region} placeLoading={regionLoading} />
  );
  const priceDrops = (
    <PriceDropsRow key="price-drops" place={region} placeLoading={regionLoading} />
  );
  const justListedRent = (
    <JustListedRow key="just-listed-rent" side="rent" place={region} placeLoading={regionLoading} />
  );
  const comingSoonRent = (
    <ComingSoonRow key="coming-soon-rent" side="rent" place={region} placeLoading={regionLoading} />
  );

  const priceSortRows = (rentFirst ? (['rent', 'sale'] as const) : (['sale', 'rent'] as const)).map(
    (side) => <PriceSortRow key={side} side={side} place={region} placeLoading={regionLoading} />,
  );

  const rows = rentFirst
    ? [
        nearYouRent,
        nearYouSale,
        savedLike,
        justListedSale,
        justListedRent,
        comingSoonRent,
        comingSoonSale,
        priceDrops,
      ]
    : [
        nearYouSale,
        nearYouRent,
        savedLike,
        justListedSale,
        comingSoonSale,
        priceDrops,
        justListedRent,
        comingSoonRent,
      ];

  // Today's rows are the default for every path that is not a ready feed: flag off, control arm,
  // opt-out, a cold visit, an error and a fallback answer. A visitor never sees an empty page.
  const body =
    feedState.status === 'ready' ? (
      <>
        <FeedRows feed={feedState.feed} />
        {savedLike}
      </>
    ) : feedState.status === 'pending' ? (
      <FeedSkeleton />
    ) : (
      rows
    );

  return (
    <ShownProvider>
      <HomeBatchProvider
        place={region}
        placeLoading={regionLoading}
        enabled={feedState.status === 'off'}
      >
        {body}

        {priceSortRows}
      </HomeBatchProvider>

      <ExploreNeighborhoodsRow region={region} regionLoading={regionLoading} />

      <TrustBlock />
    </ShownProvider>
  );
}
