'use client';
import { useEffect, useRef, useState } from 'react';
import { PROPERTY_TYPES } from '@cribstop/property-contracts';
import type {
  NeighborhoodRow as NeighborhoodApiRow,
  PropertyType,
} from '@cribstop/property-contracts';
import { useApp } from '@/lib/context';
import { listRecentSavedHomes } from '@/lib/api/saved-homes';
import ListingRow from '@/components/ListingRow';
import NeighborhoodRow, { type Neighborhood } from '@/components/NeighborhoodRow';
import { getListingsMeta, getNeighborhoods, searchListings } from '@/lib/api/listings';
import type { ListingSearchQuery } from '@/lib/api/listings';
import type { ListingCardRow, ListingsMeta } from '@/lib/types';
import { addressCity, addressState, searchTargetUrl } from '@/lib/search-place';
import { formatRelativeTime } from '@/lib/format';
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

/** Small — a carousel shows a handful of cards, never a full results page. */
const CAROUSEL_PAGE_SIZE = 8;

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

/** True once the client has read a rent last search. `false` until then (and forever if there is
 *  none) — server render always sees no history. */
function useRentFirst(): boolean {
  const [rentFirst, setRentFirst] = useState(false);
  useEffect(() => {
    setRentFirst(lastSearchedSide() === 'rent');
  }, []);
  return rentFirst;
}

/** A place to scope a row's query by (#416): a place-named row must be that place's own count,
 *  never a platform-wide one. `null` when the visitor has never searched — never a guessed or
 *  IP-derived location. */
function lastSearchedPlace(): { city: string; state: string } | null {
  const address = latestRecentSearch()?.address ?? {};
  const city = addressCity(address);
  const state = addressState(address);
  return city && state ? { city, state } : null;
}

/** Client-only, like `useRentFirst`: server render always sees no place. */
function useLastSearchedPlace(): { city: string; state: string } | null {
  const [place, setPlace] = useState<{ city: string; state: string } | null>(null);
  useEffect(() => {
    setPlace(lastSearchedPlace());
  }, []);
  return place;
}

/** A resolved visitor region (#363): city/state granularity only, never coordinates. */
type Region = { city: string; state: string };

type RegionState = { region: Region | null; loading: boolean };

/**
 * Fetches the visitor's IP region once per page load, through the Next.js proxy route
 * (`/api/geo/region`), which already reduces the gateway's response to `{ city, state } | null` —
 * a non-US region, a 204, or a failed lookup all arrive here as `null`. One fetch, shared by every
 * row below that scopes itself to the region, rather than each row fetching its own.
 */
function useRegion(): RegionState {
  const [state, setState] = useState<RegionState>({ region: null, loading: true });

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/geo/region', { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((region: Region | null) => setState({ region, loading: false }))
      .catch(() => setState({ region: null, loading: false }));
    return () => controller.abort();
  }, []);

  return state;
}

type CarouselState = {
  listings: ListingCardRow[];
  total: number;
  loading: boolean;
  /** true once the fetch has settled with an error — shows retry UI instead of blank. */
  failed: boolean;
};

/**
 * Fetches one carousel's rows against the live Property API.
 *
 * Each carousel owns its own request and its own state, so one failing (or slow) fetch never
 * blocks or blanks the others — they render in parallel because each is an independent effect
 * fired on mount / whenever `query` changes, not a chain of awaits.
 */
function useCarouselListings(query: ListingSearchQuery, skip = false, skipLoading = false) {
  const [state, setState] = useState<CarouselState>({
    listings: [],
    total: 0,
    loading: true,
    failed: false,
  });
  const [retryKey, setRetryKey] = useState(0);
  // Query objects are re-created on every render, so key the effect on their serialized form
  // rather than the object identity — otherwise it would re-fetch every render.
  const queryKey = JSON.stringify(query);
  // A generation token, not the abort signal alone: a request this run's own cleanup aborted
  // still lands its result if no later run has since started — only a run an actually newer one
  // superseded skips its `setState`.
  const generation = useRef(0);

  const refetch = () => setRetryKey((k) => k + 1);

  useEffect(() => {
    const myGeneration = ++generation.current;

    // No place to scope to (#363's near-you row, before the region resolves or once it
    // resolves to none): never fires an unscoped, platform-wide request. `skipLoading` tells
    // the two `skip` cases apart — still waiting on the region (show the skeleton) versus
    // resolved with no region at all (settle empty so the row hides).
    if (skip) {
      setState({ listings: [], total: 0, loading: skipLoading, failed: false });
      return undefined;
    }

    const controller = new AbortController();
    setState({ listings: [], total: 0, loading: true, failed: false });

    // #755. A row shows a handful of cards and never pages, so it skips the exact match count.
    // `total` then holds the number of cards returned, which is all the rows below read.
    searchListings({ ...query, skipTotal: true }, controller.signal)
      .then((envelope) => {
        // A superseded request (a chip pick that moved on before this one returned) must never
        // overwrite the newer one's state.
        if (generation.current !== myGeneration) return;
        setState({
          listings: envelope.results,
          total: envelope.total,
          loading: false,
          failed: false,
        });
      })
      .catch((err) => {
        if (generation.current !== myGeneration) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setState({ listings: [], total: 0, loading: false, failed: true });
      });

    return () => controller.abort();
  }, [queryKey, retryKey, skip, skipLoading]);

  return { ...state, refetch };
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
  const [state, setState] = useState<NeighborhoodsState>({ neighborhoods: [], loading: true });
  // A generation token, not a boolean: this run's result still lands if nothing newer has
  // started, even past an incidental cleanup — only a run that a later one has actually
  // superseded skips its `setState`.
  const generation = useRef(0);

  useEffect(() => {
    // Resets to loading on every entry into this branch, matching `useCarouselListings`'s skip
    // branch — never leaves a stale `neighborhoods` list showing were this to re-enter loading
    // after already resolving once.
    if (regionLoading) {
      setState({ neighborhoods: [], loading: true });
      return undefined;
    }

    const myGeneration = ++generation.current;
    const controller = new AbortController();

    async function load() {
      const seen = new Set<string>();
      const merged: Neighborhood[] = [];

      const add = (rows: NeighborhoodApiRow[]) => addNeighborhoodRows(rows, seen, merged);

      // The visitor's own region, city+state then state alone, ahead of every licensed-state
      // request — so a visitor's own city and state render first even when their state isn't a
      // licensed one.
      if (region) {
        const settledRegion = await Promise.allSettled([
          getNeighborhoods(
            {
              city: region.city,
              state: region.state,
              limit: NEIGHBORHOODS_PAGE_SIZE,
              minCount: NEIGHBORHOODS_MIN_COUNT,
            },
            controller.signal,
          ),
          getNeighborhoods(
            {
              state: region.state,
              limit: NEIGHBORHOODS_PAGE_SIZE,
              minCount: NEIGHBORHOODS_MIN_COUNT,
            },
            controller.signal,
          ),
        ]);
        for (const result of settledRegion) {
          if (result.status === 'fulfilled' && result.value) add(result.value.results);
        }
      }

      // `allSettled`, not `all`: one licensed state's request failing must not blank the others'
      // already-good results. Order is the input order regardless of which settles first.
      const settled = await Promise.allSettled(
        BRAND.licensedStateCodes.map((code) =>
          getNeighborhoods(
            { state: code, limit: NEIGHBORHOODS_PAGE_SIZE, minCount: NEIGHBORHOODS_MIN_COUNT },
            controller.signal,
          ),
        ),
      );
      for (const result of settled) {
        if (result.status === 'fulfilled' && result.value) add(result.value.results);
      }

      if (merged.length < NEIGHBORHOODS_TARGET) {
        const licensed = new Set<string>(BRAND.licensedStateCodes);
        try {
          const rest = await getNeighborhoods(
            { limit: NEIGHBORHOODS_PAGE_SIZE, minCount: NEIGHBORHOODS_MIN_COUNT },
            controller.signal,
          );
          if (rest) add(rest.results.filter((row) => !licensed.has(row.state)));
        } catch {
          // The row still shows whatever the licensed-state requests already collected.
        }
      }

      if (generation.current === myGeneration) setState({ neighborhoods: merged, loading: false });
    }

    load();
    return () => controller.abort();
  }, [region, regionLoading]);

  return state;
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
  const [meta, setMeta] = useState<ListingsMeta | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getListingsMeta(controller.signal)
      .then(setMeta)
      .catch(() => {
        // Chrome, not a task: the affected tiles simply don't render.
      });
    return () => controller.abort();
  }, []);

  return meta;
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

function JustListedRow({ side }: { side: ListingSide }) {
  const { listings, total, loading, failed, refetch } = useCarouselListings({
    sort: 'newly-listed',
    listingType: side,
    pageSize: CAROUSEL_PAGE_SIZE,
  });

  const show = loading || total > 0 || failed;
  if (!show) return null;

  return (
    <ListingRow
      title={JUST_LISTED_TITLE[side]}
      href={searchHref(side, { sort: 'newly-listed' })}
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
  region: Region | null;
  regionLoading: boolean;
}) {
  const { listings, total, loading } = useCarouselListings(
    {
      listingType: side,
      city: region?.city,
      state: region?.state,
      sort: 'newest',
      pageSize: CAROUSEL_PAGE_SIZE,
    },
    regionLoading || !region,
    regionLoading,
  );

  // No error UI (#363): a failed fetch hides the row exactly like a real zero total, rather than
  // showing a retry card scoped to a place the visitor never entered themselves.
  if (!loading && total === 0) return null;

  return (
    <ListingRow
      title={NEAR_YOU_TITLE[side]}
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
function ComingSoonRow({ side }: { side: ListingSide }) {
  const place = useLastSearchedPlace();
  // Scoped to the visitor's own last-searched place (#416) even with no subtitle to name it —
  // relevance the copy doesn't have to spell out.
  const { listings, total, loading, failed, refetch } = useCarouselListings({
    status: ['Coming Soon'],
    sort: 'newest',
    listingType: side,
    pageSize: CAROUSEL_PAGE_SIZE,
    city: place?.city,
    state: place?.state,
  });

  const show = loading || total > 0 || failed;
  if (!show) return null;

  return (
    <ListingRow
      title={COMING_SOON_TITLE[side]}
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
function PriceDropsRow() {
  const { listings, total, loading, failed, refetch } = useCarouselListings({
    priceReduced: true,
    sort: 'newly-listed',
    listingType: 'sale',
    pageSize: CAROUSEL_PAGE_SIZE,
  });

  const show = loading || total > 0 || failed;
  if (!show) return null;

  return (
    <ListingRow
      title="Price drops on homes for sale"
      href={searchHref('sale', { priceReduced: 'true' })}
      listings={listings}
      loading={loading}
      failed={failed}
      onRetry={refetch}
      max={7}
      sectionClassName="px-6 pt-3 sm:px-10 lg:px-20"
    />
  );
}

type PriceSort = 'price-asc' | 'price-desc';

/** Titles describe price only (Fair Housing). "Cheapest"/"Priciest" name the sort, never a place. */
const PRICE_SORT_TITLE: Record<ListingSide, Record<PriceSort, string>> = {
  sale: { 'price-asc': 'Cheapest homes for sale', 'price-desc': 'Priciest homes for sale' },
  rent: { 'price-asc': 'Cheapest rentals', 'price-desc': 'Priciest rentals' },
};

const PRICE_SORT_OPTIONS: { value: PriceSort; label: string }[] = [
  { value: 'price-asc', label: 'Lowest' },
  { value: 'price-desc', label: 'Highest' },
];

/** Data-quality floors, not budget caps. The feed holds placeholder prices (sale $500, rent $0)
 *  that would head the low-to-high rows. Real low prices sit above these (#478). */
const PRICE_FLOOR: Record<ListingSide, number> = { sale: 5_000, rent: 200 };

/** The sale row shows homes, not lots: `Land` at $999 headed the low-to-high row. */
const SALE_HOME_TYPES = PROPERTY_TYPES.filter((type) => type !== 'Land');

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
 * visitor's last searched place, else the IP region, like the other rows.
 */
function PriceSortRow({ side, region }: { side: ListingSide; region: Region | null }) {
  const [sort, setSort] = useState<PriceSort>('price-asc');
  const place = useLastSearchedPlace() ?? region;

  const { listings, total, loading, failed, refetch } = useCarouselListings({
    listingType: side,
    sort,
    minPrice: PRICE_FLOOR[side],
    ...(side === 'sale' ? { propertyType: SALE_HOME_TYPES } : {}),
    pageSize: CAROUSEL_PAGE_SIZE,
    city: place?.city,
    state: place?.state,
  });

  if (!loading && !failed && total === 0) return null;

  return (
    <ListingRow
      title={PRICE_SORT_TITLE[side][sort]}
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

/**
 * Row order (#394 stakeholder ruling, #363): "Near you" leads the body, sale then rent — the
 * first row a visitor sees is scoped to their own region, not a platform-wide feed. Just listed
 * (sale), Coming soon (sale) and Price drops are sale rows; "Rentals" is its own two-row cluster
 * (just listed, then coming soon) that normally follows Price drops. When the visitor's last
 * search was rent, both the "Near you" pair and the rentals cluster move up — `useRentFirst` is
 * the only thing that changes; nothing about the rows themselves does.
 */
export default function HomePageContent() {
  const rentFirst = useRentFirst();
  const { region, loading: regionLoading } = useRegion();
  const { user, savedPropertyIds } = useApp();
  const { save: latestSave, loading: saveLoading } = useLatestSave(user?.email ?? null);
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
  const justListedSale = <JustListedRow key="just-listed-sale" side="sale" />;
  const comingSoonSale = <ComingSoonRow key="coming-soon-sale" side="sale" />;
  const priceDrops = <PriceDropsRow key="price-drops" />;
  const justListedRent = <JustListedRow key="just-listed-rent" side="rent" />;
  const comingSoonRent = <ComingSoonRow key="coming-soon-rent" side="rent" />;

  const priceSortRows = (rentFirst ? (['rent', 'sale'] as const) : (['sale', 'rent'] as const)).map(
    (side) => <PriceSortRow key={side} side={side} region={region} />,
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

  return (
    <>
      {rows}

      {priceSortRows}

      <ExploreNeighborhoodsRow region={region} regionLoading={regionLoading} />

      <TrustBlock />
    </>
  );
}
