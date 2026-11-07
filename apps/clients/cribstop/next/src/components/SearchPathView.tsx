import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { type ParsedSearchPath, searchPath } from '@cribstop/property-contracts';
import JsonLd from '@/components/JsonLd';
import ListingsInfoPopover from '@/components/ListingsInfoPopover';
import SearchExperience from '@/components/SearchExperience';
import AreaLinks, { type NearbyLink } from '@/components/AreaLinks';
import { loadCityStats } from '@/lib/api/city-stats';
import { loadCityNeighborhoods } from '@/lib/api/neighborhood-groups';
import { loadCityZips } from '@/lib/api/zip-groups';
import { nearbyNeighborhoods, neighborhoodBreadcrumbs } from '@/lib/neighborhood-page';
import { breadcrumbJsonLd, nearbyZips, zipBreadcrumbs } from '@/lib/zip-page';
import { initialRequestFor, loadInitialResults } from '@/lib/api/listings-initial';
import HydratedSearch from '@/lib/query/HydratedSearch';
import { BRAND } from '@/lib/brand';
import { cityRobots, citySummary, cityTitle } from '@/lib/city-summary';
import { formatDate } from '@/lib/format';
import { publishableOrigin } from '@/lib/publishable-origin';
import { searchRouteProps } from '@/lib/search-route';
import { searchCanonical, searchUrlKind, thinPageMinListings } from '@/lib/seo-config';

/**
 * A search path page (#350), for a place (`/alexandria-va/homes-for-sale`) or a map area
 * (`/homes-for-sale?boundary=...`). The server resolves the path, so that the first render searches
 * for the right place. There is no `<Suspense>` here, for the reason in `search/page.tsx` history:
 * the results shell must be in the first HTML.
 *
 * A place page carries one visually hidden H1 and a dated summary of the feed (#842, #929). The
 * summary sits in the "About these listings" popover beside the results count (#947) and takes no
 * row. Both are plain server HTML in the first response, so neither needs a loading skeleton. When the figures cannot be read, the page keeps the H1 and drops the summary.
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
  // A bare ZIP page or a neighborhood page adds a breadcrumb trail and links to the city's other
  // ZIPs or neighborhoods (#973, #974).
  const zip = parsed.place?.kind === 'zip-only' ? parsed.place.zip : null;
  const neighborhood =
    parsed.place?.kind === 'neighborhood' && props.area && props.place.filters.neighborhood
      ? { place: parsed.place, name: props.place.filters.neighborhood, area: props.area }
      : null;
  const listingType = parsed.segment === 'homes-for-rent' ? 'rent' : 'sale';
  const [initialResults, stats, cityZips, cityNeighborhoods] = await Promise.all([
    loadInitialResults(props.initialQuery, props.place),
    label ? loadCityStats(props.initialQuery, props.place) : null,
    zip && props.area ? loadCityZips(props.area.city, props.area.state, listingType) : null,
    neighborhood
      ? loadCityNeighborhoods(neighborhood.area.city, neighborhood.area.state, listingType)
      : null,
  ]);
  const noun = parsed.segment === 'homes-for-rent' ? 'Homes for rent' : 'Homes for sale';
  const crumbs = zip
    ? zipBreadcrumbs(zip, parsed.segment, props.area)
    : neighborhood
      ? neighborhoodBreadcrumbs(
          neighborhood.place,
          neighborhood.name,
          neighborhood.area,
          parsed.segment,
        )
      : null;
  const minListings = thinPageMinListings();
  let nearby: NearbyLink[] = [];
  let nearbyHeading = '';
  let nearbyLabel = '';
  if (zip && cityZips) {
    nearby = nearbyZips(cityZips, zip, parsed.segment, minListings).map((item) => ({
      label: item.zip,
      count: item.count,
      path: item.path,
    }));
    nearbyHeading = `${noun} in nearby ZIP codes`;
    nearbyLabel = 'Nearby ZIP codes';
  } else if (neighborhood && cityNeighborhoods) {
    nearby = nearbyNeighborhoods(
      cityNeighborhoods,
      { name: neighborhood.name, ...neighborhood.area },
      parsed.segment,
      minListings,
    ).map((item) => ({ label: item.name, count: item.count, path: item.path }));
    nearbyHeading = `${noun} in other neighborhoods of ${neighborhood.area.city}`;
    nearbyLabel = 'Other neighborhoods';
  }
  // The markup must match the visible trail, and the trail shows only with the figures.
  const breadcrumbLd = crumbs && stats ? breadcrumbJsonLd(publishableOrigin(), crumbs) : null;

  const about =
    label && stats ? (
      <ListingsInfoPopover>
        {crumbs ? (
          <div className="mb-3">
            <AreaLinks
              crumbs={crumbs}
              nearby={nearby}
              heading={nearbyHeading}
              navLabel={nearbyLabel}
            />
          </div>
        ) : null}
        <p className="text-sm text-ink-body">{citySummary(label, parsed.segment, stats)}</p>
        <p className="mt-2 text-xs text-ink-muted">
          <span className="text-sm font-semibold text-ink-body">{BRAND.brokerage}</span>
          {' · '}
          <time dateTime={stats.asOf}>{`Updated ${formatDate(stats.asOf)}`}</time>
          {stats.sources.includes('brightMLS')
            ? ' · Listing information provided by Bright MLS. Each listing names its listing broker. Deemed reliable but not guaranteed.'
            : ' · Each listing names its listing broker.'}
        </p>
      </ListingsInfoPopover>
    ) : null;
  const experience = (
    <SearchExperience initialQuery={props.initialQuery} place={props.place} aboutSlot={about} />
  );
  return (
    <>
      {label ? (
        <>
          <h1 className="sr-only">{`${noun} in ${label}`}</h1>
          {breadcrumbLd ? <JsonLd data={breadcrumbLd} /> : null}
        </>
      ) : null}
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
    </>
  );
}

export async function searchPathMetadata(
  parsed: ParsedSearchPath,
  params: URLSearchParams,
): Promise<Metadata> {
  const noun = parsed.segment === 'homes-for-rent' ? 'Homes for rent' : 'Homes for sale';
  const urlKind = searchUrlKind(params);
  const origin = publishableOrigin();
  if (parsed.place === null) {
    // The map-area path. Only its clean form is an index candidate (#847).
    const canonical = searchCanonical(origin, searchPath(null, parsed.segment), urlKind);
    return {
      title: `${noun} · ${BRAND.brokerage}`,
      ...(urlKind.kind === 'clean' ? {} : { robots: { index: false, follow: true } }),
      ...(canonical ? { alternates: { canonical } } : {}),
    };
  }
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
  // The canonical link names the path without the visitor's query, except for a page of 2 or more
  // (#847). See `publishable-origin.ts`.
  const url = searchCanonical(origin, searchPath(parsed.place, parsed.segment), urlKind);
  const cityIndex = cityRobots(stats?.activeCount ?? null, thinPageMinListings());
  return {
    title,
    description,
    robots: { index: cityIndex.index && urlKind.kind === 'clean', follow: true },
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
