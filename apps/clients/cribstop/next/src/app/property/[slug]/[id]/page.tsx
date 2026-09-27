import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { idSchema, type PropertyPage } from '@cribstop/property-contracts';
import { ListingErrorState } from '@/components/listing/ListingStates';
import PropertyPageView from '@/components/listing/PropertyPageView';
import { toListingDetailView } from '@/lib/api/listings';
import { loadHomePage } from '@/lib/api/property-page';
import { BRAND } from '@/lib/brand';
import { listingMetadata, unresolvedListingMetadata } from '@/lib/listing-metadata';
import { publishableOrigin } from '@/lib/publishable-origin';

type RouteProps = { params: Promise<{ slug: string; id: string }> };

/**
 * The property page (#382), `/property/<slug>/<homeId>`. The service returns everything already
 * resolved. This route only renders it, and sends a stale slug to the canonical path with a 308.
 */

/** A malformed escape is a stale slug too, so it gets the 308 and not a 500. */
function safeDecode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

async function load(id: string) {
  return idSchema.safeParse(id).success ? loadHomePage(id) : ({ status: 'not-found' } as const);
}

/** A listing unfurls through the shared listing rules. A page with no listing uses its SEO text. */
function pageMetadata(page: PropertyPage): Metadata {
  const origin = publishableOrigin();
  if (page.latestListing !== null) {
    return listingMetadata(toListingDetailView(page.latestListing), origin);
  }
  return {
    title: `${page.seo.title} · ${BRAND.brokerage}`,
    description: page.seo.description,
    ...(page.propertyRecord.isSample ? { robots: { index: false } } : {}),
    ...(origin === null
      ? {}
      : { alternates: { canonical: `${origin.replace(/\/$/, '')}${page.canonicalPath}` } }),
  };
}

export async function generateMetadata({ params }: RouteProps): Promise<Metadata> {
  const { id } = await params;
  const state = await load(id);
  if (state.status === 'ready') return pageMetadata(state.page);
  return unresolvedListingMetadata({ noindex: state.status === 'not-found' });
}

export default async function PropertyRoute({ params }: RouteProps) {
  const { slug, id } = await params;
  const state = await load(id);

  if (state.status === 'not-found') notFound();
  if (state.status === 'error') {
    return <ListingErrorState message={state.message} className="mx-auto my-16 max-w-lg" />;
  }
  if (safeDecode(slug) !== state.page.slug) {
    permanentRedirect(state.page.canonicalPath);
  }
  return <PropertyPageView page={state.page} />;
}
