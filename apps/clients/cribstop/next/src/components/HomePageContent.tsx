'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import ListingRow from '@/components/ListingRow';
import NeighborhoodRow from '@/components/NeighborhoodRow';
import { getListingsMeta, searchListings } from '@/lib/api/listings';
import type { ListingSearchQuery } from '@/lib/api/listings';
import type { ListingCardRow, ListingsMeta } from '@/lib/types';
import { searchTargetUrl } from '@/lib/search-place';
import { formatRelativeTime } from '@/lib/format';
import Link from 'next/link';
import { BRAND } from '@/lib/brand';

/** The three choices the intent control offers. Never `'sold'` — this page only browses. */
const INTENT_VALUES = ['sale', 'rent', 'all'] as const;
type Intent = (typeof INTENT_VALUES)[number];

/** Small — a carousel shows a handful of cards, never a full results page. */
const CAROUSEL_PAGE_SIZE = 8;

const INTENT_STORAGE_KEY = 'cribstop:home-intent';

/** `?show=` spelling → the internal `listingType` value (#392). Values drawn from `INTENT_VALUES`
 *  — an entry pointing outside that set fails to compile. */
const SHOW_PARAM_TO_INTENT: Record<string, Intent> = { sale: 'sale', rent: 'rent', both: 'all' };

function isIntent(value: string | null): value is Intent {
  return (INTENT_VALUES as readonly string[]).includes(value ?? '');
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
function searchHref(intent: Intent, params: Record<string, string>): string {
  return searchTargetUrl(
    { kind: 'area', params: new URLSearchParams() },
    intent,
    new URLSearchParams(params),
  );
}

/**
 * Reads `?show=` reactively — a `<Suspense>`-wrapped leaf per the same pattern as
 * `AuthModalListener` (`useSearchParams` unwinds to a Suspense boundary during static generation).
 * A plain `window.location.search` read on mount would miss a client-side navigation to a new
 * `?show=` on this same route; `useSearchParams` re-renders this leaf whenever it changes.
 */
function ShowParamWatcher({ onChange }: { onChange: (show: string | null) => void }) {
  const show = useSearchParams().get('show');
  useEffect(() => onChange(show), [show, onChange]);
  return null;
}

/** A pill-shaped toggle button, shared by the intent control's radios and the budget chips. */
function PillButton({
  active,
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) {
  return (
    <button
      type="button"
      className={`rounded-full border px-4 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 ${
        active
          ? 'border-brand-900 bg-brand-900 text-white'
          : 'border-surface-border bg-white text-ink hover:bg-surface-alt'
      } ${className}`}
      {...props}
    />
  );
}

/**
 * The intent control (#392): "For sale" / "For rent" / "Both", default "Both".
 *
 * Body-owned and independent of the search bar's own `listingType` (#361 rule) — it never reads or
 * writes `useApp()`. `?show=` overrides the default and stays reactive to it; a manual pick
 * persists to `localStorage` and is read back on a later visit that carries no `?show=`.
 */
function useIntentControl(showParam: string | null): [Intent, (next: Intent) => void] {
  const [intent, setIntent] = useState<Intent>('all');
  // Whether the persisted value has already been consulted — read at most once, so a manual pick
  // (or a `?show=` that later clears) can never be clobbered by a stale replay of this effect.
  const [consultedStorage, setConsultedStorage] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const fromQuery = SHOW_PARAM_TO_INTENT[showParam ?? ''];
    if (fromQuery) {
      setIntent(fromQuery);
      return;
    }
    if (consultedStorage) return;
    setConsultedStorage(true);
    try {
      const persisted = window.localStorage.getItem(INTENT_STORAGE_KEY);
      if (isIntent(persisted)) setIntent(persisted);
    } catch {
      // Chrome, not a task: private-browsing / disabled storage just keeps the default.
    }
  }, [showParam, consultedStorage]);

  const choose = (next: Intent) => {
    setIntent(next);
    try {
      window.localStorage.setItem(INTENT_STORAGE_KEY, next);
    } catch {
      // Chrome, not a task.
    }
  };

  return [intent, choose];
}

const INTENT_OPTIONS: { value: Intent; label: string }[] = [
  { value: 'sale', label: 'For sale' },
  { value: 'rent', label: 'For rent' },
  { value: 'all', label: 'Both' },
];

function IntentControl({ value, onChange }: { value: Intent; onChange: (next: Intent) => void }) {
  return (
    <div
      role="radiogroup"
      aria-label="Show homes for sale, for rent, or both"
      className="inline-flex gap-1 rounded-full border border-surface-border bg-white p-1 shadow-sm"
    >
      {INTENT_OPTIONS.map((option) => (
        <PillButton
          key={option.value}
          active={value === option.value}
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </PillButton>
      ))}
    </div>
  );
}

/** "Coming soon" (#392): listed early, showings not started. Hidden while empty and settled. */
function ComingSoonRow({ intent }: { intent: Intent }) {
  const { listings, total, loading, failed, refetch } = useCarouselListings({
    status: ['Coming Soon'],
    sort: 'newest',
    listingType: intent,
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
      href={searchHref(intent, { status: 'Coming Soon' })}
      listings={listings}
      loading={loading}
      failed={failed}
      onRetry={refetch}
      max={7}
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
          sectionClassName="pt-4"
          titleClassName="font-display text-lg font-bold tracking-tight"
        />
      )}
    </div>
  );
}

/** "What your budget buys" (#392): one sub-row per listing type visible under the intent control. */
function BudgetSection({ intent }: { intent: Intent }) {
  return (
    <section className="mx-auto mt-12 max-w-[1760px] px-6 sm:px-10 lg:px-20">
      <h2 className="font-display text-xl font-bold tracking-tight sm:text-2xl">
        What your budget buys
      </h2>
      <div className="mt-6 flex flex-col gap-10">
        {intent !== 'rent' && <BudgetSubRow key="sale" type="sale" bands={SALE_BANDS} />}
        {intent !== 'sale' && <BudgetSubRow key="rent" type="rent" bands={RENT_BANDS} />}
      </div>
    </section>
  );
}

/** The brokerage trust block (#392): facts only — no unsourced claims (PRD §6.3). */
function TrustBlock() {
  const meta = useListingsMeta();
  const lastUpdated = meta?.dataUpdatedAt != null ? formatRelativeTime(meta.dataUpdatedAt) : null;

  return (
    <section className="mx-auto mt-16 max-w-[1760px] px-6 pb-16 sm:px-10 lg:px-20">
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
  const [showParam, setShowParam] = useState<string | null>(null);
  const [intent, setIntent] = useIntentControl(showParam);

  return (
    <>
      <Suspense fallback={null}>
        <ShowParamWatcher onChange={setShowParam} />
      </Suspense>

      <div className="mx-auto flex max-w-[1760px] justify-center px-6 pt-8 sm:px-10 lg:justify-start lg:px-20">
        <IntentControl value={intent} onChange={setIntent} />
      </div>

      <ComingSoonRow intent={intent} />

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

      <BudgetSection intent={intent} />

      <TrustBlock />
    </>
  );
}
