import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { idSchema, type PropertyPage } from '@cribstop/property-contracts';
import { ListingErrorState } from '@/components/listing/ListingStates';
import PropertyPageView from '@/components/listing/PropertyPageView';
import { toListingDetailView } from '@/lib/api/listings';
import {
  loadPropertyByHomeId,
  loadPropertyPage,
  type PropertyPageState,
} from '@/lib/api/property-page';
import { BRAND } from '@/lib/brand';
import { listingMetadata, unresolvedListingMetadata } from '@/lib/listing-metadata';
import { publishableOrigin } from '@/lib/publishable-origin';

type RouteProps = { params: Promise<{ slug: string; id: string }> };

/**
 * The property page (#382, corrected #386), `/property/<slug>/<listingId>`. The id is the
 * property's most recent listing. The service returns everything already resolved. This route
 * only renders it, and sends a stale slug to the canonical path with a 308. An older listing id
 * still resolves the same page, so it is not compared and never redirects.
 */

/** A malformed escape is a stale slug too, so it gets the 308 and not a 500. */
function safeDecode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/**
 * `id` is a listing id. A property/unit id from a stale #382 URL 404s there, so this falls back
 * to the old lookup and marks the result: the caller always redirects a home-id match, since its
 * own id never matches the URL's.
 */
async function load(id: string): Promise<PropertyPageState & { viaHomeId?: true }> {
  if (!idSchema.safeParse(id).success) return { status: 'not-found' };
  const byListing = await loadPropertyPage(id);
  if (byListing.status !== 'not-found') return byListing;
  const byHome = await loadPropertyByHomeId(id);
  return byHome.status === 'ready' ? { ...byHome, viaHomeId: true } : byListing;
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
  if (state.viaHomeId || safeDecode(slug) !== state.page.slug) {
    permanentRedirect(state.page.canonicalPath);
  }
  return <PropertyPageView page={state.page} />;
}
