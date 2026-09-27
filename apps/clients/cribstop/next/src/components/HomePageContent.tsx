'use client';
import { useEffect, useState } from 'react';
import ListingRow from '@/components/ListingRow';
import NeighborhoodRow from '@/components/NeighborhoodRow';
import { getListingsMeta, searchListings } from '@/lib/api/listings';
import type { ListingSearchQuery } from '@/lib/api/listings';
import type { ListingCardRow, ListingsMeta } from '@/lib/types';
import { searchTargetUrl } from '@/lib/search-place';
import { formatRelativeTime } from '@/lib/format';
import Link from 'next/link';
import { BRAND } from '@/lib/brand';

/** The one distinction this page ever browses by. Never `'all'`/`'sold'` — #398 always shows both
 *  sale and rent, each as its own section. */
type ListingSide = 'sale' | 'rent';

/** Small — a carousel shows a handful of cards, never a full results page. */
const CAROUSEL_PAGE_SIZE = 8;

/**
 * The recent-search storage `CompactSearchBar` already writes (`recentSearches`). #398 reuses this
 * key rather than adding one: an entry now carries the listing type active at the time of that
 * search, so the newest entry says which side the visitor searched last.
 */
function lastSearchedSide(): ListingSide | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem('recentSearches');
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    const latest = Array.isArray(parsed) ? parsed[0] : null;
    return latest?.listingType === 'rent' ? 'rent' : latest?.listingType === 'sale' ? 'sale' : null;
  } catch {
    return null;
  }
}

/**
 * The page's two sections, ordered by the visitor's own last search. `['sale', 'rent']` until the
 * client reads `localStorage` (server render has none), so the order can shift once on mount — the
 * same trade-off the removed intent control made.
 */
function useSectionOrder(): [ListingSide, ListingSide] {
  const [rentFirst, setRentFirst] = useState(false);
  useEffect(() => {
    setRentFirst(lastSearchedSide() === 'rent');
  }, []);
  return rentFirst ? ['rent', 'sale'] : ['sale', 'rent'];
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
function useCarouselListings(query: ListingSearchQuery) {
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

  const refetch = () => setRetryKey((k) => k + 1);

  useEffect(() => {
    const controller = new AbortController();
    setState({ listings: [], total: 0, loading: true, failed: false });

    searchListings(query, controller.signal)
      .then((envelope) => {
        // A superseded request (a chip pick that moved on before this one returned) must never
        // overwrite the newer one's state, whether or not the environment actually cancelled the
        // underlying fetch on `abort()`.
        if (controller.signal.aborted) return;
        setState({
          listings: envelope.results,
          total: envelope.total,
          loading: false,
          failed: false,
        });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setState({ listings: [], total: 0, loading: false, failed: true });
      });

    return () => controller.abort();
  }, [queryKey, retryKey]);

  return { ...state, refetch };
}

const NEIGHBORHOODS = [
  {
    name: 'Penn Quarter',
    city: 'Washington, DC',
    img: 'https://images.unsplash.com/photo-1501594907352-04cda38ebc29?w=900&auto=format&fit=crop&q=75',
  },
  {
    name: 'Federal Hill',
    city: 'Baltimore, MD',
    img: 'https://images.unsplash.com/photo-1449157291145-7efd050a4d0e?w=900&auto=format&fit=crop&q=75',
  },
  {
    name: 'Old Town',
    city: 'Alexandria, VA',
    img: 'https://images.unsplash.com/photo-1486325212027-8081e485255e?w=900&auto=format&fit=crop&q=75',
  },
  {
    name: 'Downtown Bethesda',
    city: 'Bethesda, MD',
    img: 'https://images.unsplash.com/photo-1460317442991-0ec209397118?w=900&auto=format&fit=crop&q=75',
  },
  {
    name: 'Logan Circle',
    city: 'Washington, DC',
    img: 'https://images.unsplash.com/photo-1464983953574-0892a716854b?w=900&auto=format&fit=crop&q=75',
  },
  {
    name: 'Fells Point',
    city: 'Baltimore, MD',
    img: 'https://images.unsplash.com/photo-1465101046530-73398c7f28ca?w=900&auto=format&fit=crop&q=75',
  },
  {
    name: 'Del Ray',
    city: 'Alexandria, VA',
    img: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=900&auto=format&fit=crop&q=75',
  },
  {
    name: 'Chevy Chase',
    city: 'Bethesda, MD',
    img: 'https://images.unsplash.com/photo-1460474647541-4edd0cd0c746?w=900&auto=format&fit=crop&q=75',
  },
];

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

/**
 * A pill-shaped toggle button, used by the budget chips. Active state matches the app's one
 * canonical selected-chip style (`FilterModalContent`'s Home Type / Amenities chips): black fill,
 * not a brand color — #398 found the previous `brand-900` fill read as an off-theme dark red.
 */
function PillButton({
  active,
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) {
  return (
    <button
      type="button"
      className={`inline-flex min-h-11 items-center justify-center rounded-full border px-4 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 ${
        active
          ? 'border-ink bg-ink text-white'
          : 'border-surface-border bg-white text-ink hover:bg-surface-alt'
      } ${className}`}
      {...props}
    />
  );
}

/** "Coming soon" (#392): listed early, showings not started. Hidden while empty and settled. */
function ComingSoonRow({ side }: { side: ListingSide }) {
  const { listings, total, loading, failed, refetch } = useCarouselListings({
    status: ['Coming Soon'],
    sort: 'newest',
    listingType: side,
    pageSize: CAROUSEL_PAGE_SIZE,
  });

  const show = loading || total > 0 || failed;
  if (!show) return null;

  return (
    <ListingRow
      title="Coming soon"
      subtitle={
        loading ? undefined : `${total.toLocaleString()} listed early. Showings have not started.`
      }
      href={searchHref(side, { status: 'Coming Soon' })}
      listings={listings}
      loading={loading}
      failed={failed}
      onRetry={refetch}
      max={7}
      sectionClassName="px-6 pt-3 sm:px-10 lg:px-20"
    />
  );
}

interface BudgetBand {
  label: string;
  minPrice?: number;
  maxPrice?: number;
}

const SALE_BANDS: BudgetBand[] = [
  { label: 'Under $300K', maxPrice: 300_000 },
  { label: '$300K–$500K', minPrice: 300_000, maxPrice: 500_000 },
  { label: '$500K–$750K', minPrice: 500_000, maxPrice: 750_000 },
  { label: '$750K–$1M', minPrice: 750_000, maxPrice: 1_000_000 },
  { label: '$1M+', minPrice: 1_000_000 },
];

const RENT_BANDS: BudgetBand[] = [
  { label: 'Under $1,500', maxPrice: 1_500 },
  { label: '$1,500–$2,500', minPrice: 1_500, maxPrice: 2_500 },
  { label: '$2,500–$4,000', minPrice: 2_500, maxPrice: 4_000 },
  { label: '$4,000+', minPrice: 4_000 },
];

/**
 * One "What your budget buys" sub-row: chips for one fixed listing type, and the selected band's
 * cards. `bands[selected] ?? bands[0]` is a defensive clamp only — the sale row (5 bands) and the
 * rent row (4 bands) are each rendered with their own `key` in `BudgetSection`, so React never
 * reuses one's `selected` state for the other's shorter array.
 */
function BudgetSubRow({ type, bands }: { type: 'sale' | 'rent'; bands: BudgetBand[] }) {
  const [selected, setSelected] = useState(0);
  const band = bands[selected] ?? bands[0];

  const { listings, total, loading, failed, refetch } = useCarouselListings({
    listingType: type,
    minPrice: band.minPrice,
    maxPrice: band.maxPrice,
    sort: 'newest',
    pageSize: CAROUSEL_PAGE_SIZE,
  });

  // A real, empty result — distinct from "still loading" and from "the fetch failed". The chips
  // stay live so the visitor can pick another band without an empty scroller under them.
  const empty = !loading && !failed && total === 0;

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {bands.map((b, i) => (
          <PillButton
            key={b.label}
            active={i === selected}
            aria-pressed={i === selected}
            onClick={() => setSelected(i)}
          >
            {b.label}
          </PillButton>
        ))}
      </div>
      {empty ? (
        <p className="mt-4 text-sm text-ink-muted">
          No homes in this price range yet. Try another range.
        </p>
      ) : (
        <ListingRow
          title={type === 'sale' ? 'Homes for sale' : 'Homes for rent'}
          subtitle={loading ? undefined : `${total.toLocaleString()} homes`}
          href={searchHref(type, {
            ...(band.minPrice ? { minPrice: String(band.minPrice) } : {}),
            ...(band.maxPrice ? { maxPrice: String(band.maxPrice) } : {}),
          })}
          listings={listings}
          loading={loading}
          failed={failed}
          onRetry={refetch}
          max={7}
          sectionClassName="pt-2"
          titleClassName="font-display text-lg font-bold tracking-tight"
        />
      )}
    </div>
  );
}

/** "What your budget buys" (#392): both sub-rows, ordered by the visitor's last search (#398). */
function BudgetSection({ order }: { order: [ListingSide, ListingSide] }) {
  const bands: Record<ListingSide, BudgetBand[]> = { sale: SALE_BANDS, rent: RENT_BANDS };
  return (
    <section className="mx-auto mt-8 max-w-[1760px] px-6 sm:px-10 lg:px-20">
      <h2 className="font-display text-xl font-bold tracking-tight sm:text-2xl">
        What your budget buys
      </h2>
      <div className="mt-4 flex flex-col gap-6">
        {order.map((side) => (
          <BudgetSubRow key={side} type={side} bands={bands[side]} />
        ))}
      </div>
    </section>
  );
}

/** The brokerage trust block (#392): facts only — no unsourced claims (PRD §6.3). */
function TrustBlock() {
  const meta = useListingsMeta();
  const lastUpdated = meta?.dataUpdatedAt != null ? formatRelativeTime(meta.dataUpdatedAt) : null;

  return (
    <section className="mx-auto mt-10 max-w-[1760px] px-6 pb-10 sm:px-10 lg:px-20">
      <div className="overflow-hidden rounded-xl bg-surface-alt text-ink border border-surface-border">
        <div className="grid gap-8 px-8 py-12 sm:grid-cols-[1.4fr_1fr] sm:items-center sm:px-12 sm:py-16 lg:px-16">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-900">
              {BRAND.brokerageShort}
            </p>
            <h2 className="mt-3 font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
              Brokered by {BRAND.brokerageShort}.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-ink/80">
              {BRAND.siteName} lists homes for sale and rent, brokered by {BRAND.brokerageShort} and
              licensed in {BRAND.licensedStates}.
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

export default function HomePageContent() {
  const order = useSectionOrder();

  return (
    <>
      {order.map((side) => (
        <ComingSoonRow key={side} side={side} />
      ))}

      {/*
       * "Popular areas across the DMV" replaced: ranking areas by popularity edges toward
       * area-desirability framing on a housing product, which is the shape a steering claim takes.
       * A plain geographic statement carries the same navigational value with none of that.
       *
       * This row and its subtitle are explicitly out of scope for #392 (untouched by ticket
       * decision) even though the subtitle names states by hand — a follow-up ticket replaces the
       * whole row with data-driven neighborhoods (research doc §7).
       */}
      <NeighborhoodRow
        title="Explore neighborhoods"
        subtitle="Neighborhoods across Maryland, DC, and Virginia"
        href="/homes-for-sale?type=all&group=neighborhoods"
        neighborhoods={NEIGHBORHOODS}
        max={6}
      />

      <BudgetSection order={order} />

      <TrustBlock />
    </>
  );
}
