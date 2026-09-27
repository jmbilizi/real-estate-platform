import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { parseSearchPath, type PropertyMatch } from '@cribstop/property-contracts';
import { ListingErrorState } from '@/components/listing/ListingStates';
import { lookupProperty } from '@/lib/api/property-page';
import { unresolvedListingMetadata } from '@/lib/listing-metadata';
import SearchPathView, { searchPathMetadata } from '@/components/SearchPathView';
import { toSearchParams } from '@/lib/search-route';
import { isPropertyPath } from '../route-shape';

type RouteProps = {
  params: Promise<{ city: string; rest: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * The #349 address path, `/<city>-<st>/<address-slug>`, and the #350 place search paths,
 * `/<city>-<st>/.../homes-for-sale`. `parseSearchPath` and `../route-shape` tell them apart.
 *
 * An address path is no longer a page (#382). The lookup resolves it, reading the MLS once on a
 * miss, and one match answers 308 to its canonical `/property/<slug>/<listingId>` path.
 */

export async function generateMetadata({ params, searchParams }: RouteProps): Promise<Metadata> {
  const { city, rest } = await params;
  const search = parseSearchPath([city, ...rest]);
  if (search) return searchPathMetadata(search, toSearchParams(await searchParams));
  // A resolved address path redirects, so only the choice, the error and the 404 reach here.
  return unresolvedListingMetadata({ noindex: true });
}

export default async function PropertyPathPage({ params, searchParams }: RouteProps) {
  const { city, rest } = await params;
  const search = parseSearchPath([city, ...rest]);
  if (search) {
    return <SearchPathView parsed={search} params={toSearchParams(await searchParams)} />;
  }
  if (!isPropertyPath(city, rest)) notFound();

  const lookup = await lookupProperty(city, rest[0]);

  if (lookup.status === 'not-found') notFound();
  if (lookup.status === 'error') {
    return <ListingErrorState message={lookup.message} className="mx-auto my-16 max-w-lg" />;
  }
  if (lookup.status === 'ready') permanentRedirect(lookup.match.path);
  return <PropertyChoiceList matches={lookup.matches} />;
}

function PropertyChoiceList({ matches }: { matches: PropertyMatch[] }) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-10 sm:px-8">
      <h1 className="text-xl font-semibold tracking-tight text-ink">Choose an address</h1>
      <ul className="mt-4 space-y-2">
        {matches.map((match) => (
          <li key={match.propertyId}>
            <a
              href={match.path}
              className="block rounded-2xl border border-surface-border p-4 hover:bg-surface-soft"
            >
              <p className="font-semibold text-ink">{match.address}</p>
              <p className="text-sm text-ink-muted">
                {match.city}, {match.state} {match.zip} · {match.marketStatus}
              </p>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
