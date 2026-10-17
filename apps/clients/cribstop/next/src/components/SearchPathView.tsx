import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { type ParsedSearchPath, searchPath } from '@cribstop/property-contracts';
import SearchExperience from '@/components/SearchExperience';
import { loadCityStats } from '@/lib/api/city-stats';
import { initialRequestFor, loadInitialResults } from '@/lib/api/listings-initial';
import HydratedSearch from '@/lib/query/HydratedSearch';
import { BRAND } from '@/lib/brand';
import { cityRobots, citySummary, cityTitle } from '@/lib/city-summary';
import { formatDate } from '@/lib/format';
import { publishableOrigin } from '@/lib/publishable-origin';
import { searchRouteProps } from '@/lib/search-route';
import { thinPageMinListings } from '@/lib/seo-config';

/**
 * A search path page (#350), for a place (`/alexandria-va/homes-for-sale`) or a map area
 * (`/homes-for-sale?boundary=...`). The server resolves the path, so that the first render searches
 * for the right place. There is no `<Suspense>` here, for the reason in `search/page.tsx` history:
 * the results shell must be in the first HTML.
 *
 * A place page carries one visually hidden H1 and, below the results, a dated summary of the feed
 * (#842, #929). Both are plain server HTML in the first response, so neither needs a loading
 * skeleton. When the figures cannot be read, the page keeps the H1 and drops the summary.
 */
export default async function SearchPathView({
  parsed,
  params,
}: {
  parsed: ParsedSearchPath;
  params: URLSearchParams;
}) {
  const props = await searchRouteProps(parsed, params);
  if (props.status === 'redirect') permanentRedirect(props.to);
  if (props.status === 'not-found') notFound();
  // A lookup failure is a server error, never a 404 or a 200 page. A crawler retries a 5xx and keeps
  // the URL. An App Router page cannot set `Retry-After`, so the error boundary answers 500.
  if (props.status === 'error') throw new Error('Place lookup failed');
  const label = props.place.label;
  const [initialResults, stats] = await Promise.all([
    loadInitialResults(props.initialQuery, props.place),
    label ? loadCityStats(props.initialQuery, props.place) : null,
  ]);
  const noun = parsed.segment === 'homes-for-rent' ? 'Homes for rent' : 'Homes for sale';
  const experience = <SearchExperience initialQuery={props.initialQuery} place={props.place} />;
  return (
    <>
      {label ? <h1 className="sr-only">{`${noun} in ${label}`}</h1> : null}
      {initialResults ? (
        <HydratedSearch
          request={initialRequestFor(props.initialQuery, props.place)}
          results={initialResults}
        >
          {experience}
        </HydratedSearch>
      ) : (
        experience
      )}
      {label && stats ? (
        <section
          aria-label="About these listings"
          className="mx-auto w-full max-w-3xl px-4 pb-6 pt-4 sm:px-6"
        >
          <p className="text-sm text-ink-body">{citySummary(label, parsed.segment, stats)}</p>
          <p className="mt-1 text-xs text-ink-muted">
            <span className="text-sm font-semibold text-ink-body">{BRAND.brokerage}</span>
            {' · '}
            <time dateTime={stats.asOf}>{`Updated ${formatDate(stats.asOf)}`}</time>
            {stats.sources.includes('brightMLS')
              ? ' · Listing information provided by Bright MLS. Each listing names its listing broker. Deemed reliable but not guaranteed.'
              : ' · Each listing names its listing broker.'}
          </p>
        </section>
      ) : null}
    </>
  );
}

export async function searchPathMetadata(
  parsed: ParsedSearchPath,
  params: URLSearchParams,
): Promise<Metadata> {
  const noun = parsed.segment === 'homes-for-rent' ? 'Homes for rent' : 'Homes for sale';
  if (parsed.place === null) return { title: `${noun} · ${BRAND.brokerage}` };
  const props = await searchRouteProps(parsed, params);
  if (props.status !== 'found') {
    return { title: `${BRAND.brokerage} — ${BRAND.titleSuffix}`, robots: { index: false } };
  }
  const label = props.place.label;
  const stats = await loadCityStats(props.initialQuery, props.place);
  const title = cityTitle(label, parsed.segment);
  const description = stats
    ? citySummary(label, parsed.segment, stats)
    : `${noun} in ${label}, brokered by ${BRAND.brokerage}.`;
  // The canonical link names the path without the visitor's query. See `publishable-origin.ts`.
  const origin = publishableOrigin();
  const url = origin === null ? null : `${origin}${searchPath(parsed.place, parsed.segment)}`;
  return {
    title,
    description,
    robots: cityRobots(stats?.activeCount ?? null, thinPageMinListings()),
    ...(url ? { alternates: { canonical: url } } : {}),
    openGraph: {
      type: 'website',
      siteName: BRAND.brokerage,
      title,
      description,
      ...(url ? { url } : {}),
    },
    twitter: { card: 'summary', title, description },
  };
}
