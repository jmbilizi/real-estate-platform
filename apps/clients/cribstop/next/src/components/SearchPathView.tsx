import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import type { ParsedSearchPath } from '@cribstop/property-contracts';
import SearchExperience from '@/components/SearchExperience';
import { ListingErrorState } from '@/components/listing/ListingStates';
import { BRAND } from '@/lib/brand';
import { searchRouteProps } from '@/lib/search-route';

/**
 * A search path page (#350), for a place (`/alexandria-va/homes-for-sale`) or a map area
 * (`/homes-for-sale?boundary=...`). The server resolves the path, so that the first render searches
 * for the right place. There is no `<Suspense>` here, for the reason in `search/page.tsx` history:
 * the results shell must be in the first HTML.
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
  if (props.status === 'error') {
    return (
      <ListingErrorState
        message="We could not look up this place just now. Please try again."
        className="mx-auto my-16 max-w-lg"
      />
    );
  }
  return <SearchExperience initialQuery={props.initialQuery} place={props.place} />;
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
  return { title: `${noun} in ${props.place.label} · ${BRAND.brokerage}` };
}
