'use client';
import { useEffect, useState } from 'react';
import ListingRow from '@/components/ListingRow';
import NeighborhoodRow from '@/components/NeighborhoodRow';
import { searchListings } from '@/lib/api/listings';
import type { ListingSearchQuery } from '@/lib/api/listings';
import type { ListingCardRow } from '@/lib/types';
import Link from 'next/link';
import { useApp } from '@/lib/context';
import { BRAND } from '@/lib/brand';

/** Small — a carousel shows a handful of cards, never a full results page. */
const CAROUSEL_PAGE_SIZE = 8;

/**
 * Sale/rent floors for the "luxury" carousel. These match the thresholds already quoted in the
 * section's own copy ("$1M and above" / "$5K and above") and the `href` on its "See all" link, so
 * changing one without the other would make the row's own label lie about what it links to.
 */
const LUXURY_SALE_MIN_PRICE = 1_000_000;
const LUXURY_RENT_MIN_PRICE = 5_000;

type CarouselState = {
  listings: ListingCardRow[];
  loading: boolean;
  /** true once the fetch has settled with an error — the row renders nothing, not an error UI. */
  failed: boolean;
};

/**
 * Fetches one carousel's rows against the live Property API.
 *
 * Each carousel owns its own request and its own state, so one failing (or slow) fetch never
 * blocks or blanks the others — they render in parallel because each is an independent effect
 * fired on mount / whenever `query` changes, not a chain of awaits.
 */
function useCarouselListings(query: ListingSearchQuery): CarouselState {
  const [state, setState] = useState<CarouselState>({ listings: [], loading: true, failed: false });
  // Query objects are re-created on every render, so key the effect on their serialized form
  // rather than the object identity — otherwise it would re-fetch every render.
  const queryKey = JSON.stringify(query);

  useEffect(() => {
    const controller = new AbortController();
    setState({ listings: [], loading: true, failed: false });

    searchListings(query, controller.signal)
      .then((envelope) => setState({ listings: envelope.results, loading: false, failed: false }))
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setState({ listings: [], loading: false, failed: true });
      });

    return () => controller.abort();
  }, [queryKey]);

  return state;
}

const NEIGHBORHOODS = [
  {
    name: 'Penn Quarter',
    city: 'Washington, DC',
    count: 24,
    img: 'https://images.unsplash.com/photo-1501594907352-04cda38ebc29?w=900&auto=format&fit=crop&q=75',
  },
  {
    name: 'Federal Hill',
    city: 'Baltimore, MD',
    count: 18,
    img: 'https://images.unsplash.com/photo-1449157291145-7efd050a4d0e?w=900&auto=format&fit=crop&q=75',
  },
  {
    name: 'Old Town',
    city: 'Alexandria, VA',
    count: 31,
    img: 'https://images.unsplash.com/photo-1486325212027-8081e485255e?w=900&auto=format&fit=crop&q=75',
  },
  {
    name: 'Downtown Bethesda',
    city: 'Bethesda, MD',
    count: 15,
    img: 'https://images.unsplash.com/photo-1460317442991-0ec209397118?w=900&auto=format&fit=crop&q=75',
  },
  {
    name: 'Logan Circle',
    city: 'Washington, DC',
    count: 22,
    img: 'https://images.unsplash.com/photo-1464983953574-0892a716854b?w=900&auto=format&fit=crop&q=75',
  },
  {
    name: 'Fells Point',
    city: 'Baltimore, MD',
    count: 17,
    img: 'https://images.unsplash.com/photo-1465101046530-73398c7f28ca?w=900&auto=format&fit=crop&q=75',
  },
  {
    name: 'Del Ray',
    city: 'Alexandria, VA',
    count: 19,
    img: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=900&auto=format&fit=crop&q=75',
  },
  {
    name: 'Chevy Chase',
    city: 'Bethesda, MD',
    count: 13,
    img: 'https://images.unsplash.com/photo-1460474647541-4edd0cd0c746?w=900&auto=format&fit=crop&q=75',
  },
];

export default function HomePageContent() {
  const { listingType } = useApp();

  // `listingType=all` (the default when this query key is omitted) already excludes sold rows
  // server-side, so there is deliberately no separate "sold" carousel here.
  const featured = useCarouselListings({
    sort: 'recommended',
    listingType,
    pageSize: CAROUSEL_PAGE_SIZE,
  });
  // Replaces the old separate forSale/forRent filters: only one of the two ever rendered at a
  // time (gated on the current tab), so this fetches just the one the tab needs instead of both.
  const primary = useCarouselListings({ listingType, pageSize: CAROUSEL_PAGE_SIZE });
  const luxury = useCarouselListings({
    listingType,
    minPrice: listingType === 'sale' ? LUXURY_SALE_MIN_PRICE : LUXURY_RENT_MIN_PRICE,
    sort: 'price-desc',
    pageSize: CAROUSEL_PAGE_SIZE,
  });
  const recent = useCarouselListings({
    sort: 'newest',
    listingType,
    pageSize: CAROUSEL_PAGE_SIZE,
  });

  // A carousel with nothing to show — still loading, failed, or genuinely empty — renders
  // nothing rather than a bare heading over an empty strip. One failed carousel never blanks the
  // rest of the page because each row's visibility is decided from its own state only.
  const showFeatured = featured.loading || featured.listings.length > 0;
  const showPrimary = primary.loading || primary.listings.length > 0;
  const showLuxury = luxury.loading || luxury.listings.length > 0;
  const showRecent = recent.loading || recent.listings.length > 0;

  return (
    <>
      {showFeatured && (
        <ListingRow
          title={listingType === 'sale' ? 'Featured homes for sale' : 'Featured homes for rent'}
          subtitle={
            listingType === 'sale' ? 'Hand-picked homes for sale' : 'Hand-picked homes for rent'
          }
          href={listingType === 'sale' ? '/search?listingType=sale' : '/search?listingType=rent'}
          listings={featured.listings}
          loading={featured.loading}
          max={7}
        />
      )}

      {showPrimary && (
        <ListingRow
          title={listingType === 'sale' ? 'Popular homes for sale' : 'Available homes for rent'}
          subtitle={
            listingType === 'sale'
              ? 'Trending in Washington, Baltimore, and Northern Virginia'
              : 'Move-in ready across the DMV'
          }
          href={listingType === 'sale' ? '/search?listingType=sale' : '/search?listingType=rent'}
          listings={primary.listings}
          loading={primary.loading}
          max={7}
        />
      )}

      <NeighborhoodRow
        title="Explore neighborhoods"
        subtitle="Popular areas across the DMV"
        href="/search?group=neighborhoods"
        neighborhoods={NEIGHBORHOODS}
        max={6}
      />

      {showLuxury && (
        <ListingRow
          title={listingType === 'sale' ? 'Luxury collection for sale' : 'Luxury homes for rent'}
          subtitle={
            listingType === 'sale'
              ? 'Standout homes for sale priced $1M and above'
              : 'High-end homes for rent priced $5K and above'
          }
          href={
            listingType === 'sale'
              ? `/search?minPrice=${LUXURY_SALE_MIN_PRICE}&listingType=sale`
              : `/search?minPrice=${LUXURY_RENT_MIN_PRICE}&listingType=rent`
          }
          listings={luxury.listings}
          loading={luxury.loading}
          max={7}
        />
      )}

      {showRecent && (
        <ListingRow
          title={
            listingType === 'sale' ? 'Just listed homes for sale' : 'Just listed homes for rent'
          }
          subtitle={
            listingType === 'sale'
              ? "Fresh inventory you don't want to miss"
              : 'Newly available homes for rent'
          }
          href={listingType === 'sale' ? '/search?listingType=sale' : '/search?listingType=rent'}
          listings={recent.listings}
          loading={recent.loading}
          max={7}
        />
      )}

      <section className="mx-auto mt-16 max-w-[1760px] px-6 pb-16 sm:px-10 lg:px-20">
        <div className="overflow-hidden rounded-xl bg-surface-alt text-ink border border-surface-border">
          <div className="grid gap-8 px-8 py-12 sm:grid-cols-[1.4fr_1fr] sm:items-center sm:px-12 sm:py-16 lg:px-16">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-400">
                Real Broker LLC
              </p>
              <h2 className="mt-3 font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
                Trusted by buyers, sellers, and renters across the DMV.
              </h2>
              <p className="mt-4 text-base leading-relaxed text-ink/80">
                {BRAND.siteName} is powered by {BRAND.brokerageShort} — one of the fastest-growing
                brokerages in the country. Our agents combine deep local expertise with modern
                technology to deliver a smooth, transparent experience.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  href="/about"
                  className="inline-flex items-center justify-center rounded-full bg-brand-50 px-5 py-2.5 text-sm font-semibold text-brand-900 transition hover:bg-brand-100 hover:text-brand-900"
                >
                  Learn more
                </Link>
                <Link
                  href="/search"
                  className="inline-flex items-center justify-center rounded-full border border-brand-200 px-5 py-2.5 text-sm font-semibold text-brand-900 transition hover:bg-brand-50 hover:text-brand-900"
                >
                  Browse homes
                </Link>
              </div>
            </div>
            <dl className="grid grid-cols-3 gap-6 sm:gap-8">
              {[
                ['12k+', 'Active listings'],
                ['3', 'States covered'],
                ['MLS', 'Daily updates'],
              ].map(([big, label]) => (
                <div key={label}>
                  <dt className="font-display text-3xl font-extrabold sm:text-4xl">{big}</dt>
                  <dd className="mt-1 text-xs uppercase tracking-wider text-ink/60">{label}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>
    </>
  );
}
