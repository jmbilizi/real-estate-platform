import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { PropertyMatch, PropertyPage, PropertyRecord } from '@cribstop/property-contracts';
import { ListingErrorState } from '@/components/listing/ListingStates';
import PropertyPageView from '@/components/listing/PropertyPageView';
import { toListingDetailView } from '@/lib/api/listings';
import { loadPropertyPage, lookupProperty } from '@/lib/api/property-page';
import { BRAND } from '@/lib/brand';
import { listingMetadata, unresolvedListingMetadata } from '@/lib/listing-metadata';
import { publishableOrigin } from '@/lib/publishable-origin';
import { isPropertyPath } from '../route-shape';

/**
 * The property page route (#349): `/<city>-<st>/<address-slug>`.
 *
 * A catch-all because #350 adds search paths (`/<city>-<st>/homes-for-sale/...`) under the same
 * prefix — see `../route-shape` for the rule that tells a property path from a search path, and
 * for why a static route (`/about`, `/search`, `/login`, ...) is never shadowed by this segment.
 *
 * The requested path is resolved by address lookup and rendered as found. It is never compared
 * against the canonical `page.path` the service returns, so a short form that omits the ZIP still
 * renders rather than redirecting to the longer canonical one. (The reverse direction — a hard
 * load of `/listing/[id]` redirecting to this page — is `listing/[id]/page.tsx`'s job.)
 */

type Resolved =
  | { kind: 'property'; page: PropertyPage }
  /** More than one property answered the same two segments: let the visitor pick. */
  | { kind: 'choice'; matches: PropertyMatch[] }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string };

async function resolveRoute(citySegment: string, addressSegment: string): Promise<Resolved> {
  const lookup = await lookupProperty(citySegment, addressSegment);

  if (lookup.status === 'not-found') return { kind: 'not-found' };
  if (lookup.status === 'error') return { kind: 'error', message: lookup.message };
  if (lookup.status === 'ambiguous') return { kind: 'choice', matches: lookup.matches };

  const pageState = await loadPropertyPage(lookup.match.listingId);
  if (pageState.status === 'not-found') return { kind: 'not-found' };
  if (pageState.status === 'error') return { kind: 'error', message: pageState.message };
  return { kind: 'property', page: pageState.page };
}

/** A neutral preview for a page NAR 7.58 keeps unlisted: address + city + state, no price, no
 *  photo, no description. */
function offMarketMetadata(propertyRecord: PropertyRecord): Metadata {
  const location = [propertyRecord.address, propertyRecord.city, propertyRecord.state]
    .filter(Boolean)
    .join(', ');
  return { title: `${location} · ${BRAND.brokerage}` };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string; rest: string[] }>;
}): Promise<Metadata> {
  const { city, rest } = await params;
  if (!isPropertyPath(city, rest)) return unresolvedListingMetadata({ noindex: true });

  const resolved = await resolveRoute(city, rest[0]);

  if (resolved.kind === 'property') {
    const { page } = resolved;
    if (page.detail === null) return offMarketMetadata(page.propertyRecord);
    return listingMetadata(toListingDetailView(page.detail), publishableOrigin());
  }
  if (resolved.kind === 'choice') return unresolvedListingMetadata({ noindex: true });
  return unresolvedListingMetadata({ noindex: resolved.kind === 'not-found' });
}

export default async function PropertyPathPage({
  params,
}: {
  params: Promise<{ city: string; rest: string[] }>;
}) {
  const { city, rest } = await params;
  // Not a property path: #350's search segments own every other shape under this prefix.
  if (!isPropertyPath(city, rest)) notFound();

  const resolved = await resolveRoute(city, rest[0]);

  if (resolved.kind === 'not-found') notFound();
  if (resolved.kind === 'error') {
    return <ListingErrorState message={resolved.message} className="mx-auto my-16 max-w-lg" />;
  }
  if (resolved.kind === 'choice') return <PropertyChoiceList matches={resolved.matches} />;

  return <PropertyPageView page={resolved.page} />;
}

function PropertyChoiceList({ matches }: { matches: PropertyMatch[] }) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-10 sm:px-8">
      <h1 className="text-xl font-semibold tracking-tight text-ink">Choose an address</h1>
      <ul className="mt-4 space-y-2">
        {matches.map((match) => (
          <li key={match.listingId}>
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
