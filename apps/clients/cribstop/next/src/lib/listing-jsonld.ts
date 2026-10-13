import { searchPath } from '@cribstop/property-contracts';
import type { ListingDetailView } from '@/lib/api/listings';
import { BRAND } from '@/lib/brand';
import { formatListingProvenance } from '@/lib/listing-format';
import { shareHeading } from '@/lib/listing-share';

/**
 * Structured data for a listing page (#843).
 *
 * JSON-LD is a publication. It reads the same fields as the visible page, so a masked address
 * stays masked and a withheld price emits no `Offer`.
 *
 * Google has no rich result for `RealEstateListing`. Bing and AI engines parse it.
 */

const OFFER_STATUSES = new Set<ListingDetailView['status']>(['Active', 'Coming Soon']);
/** A listing past Pending gets no JSON-LD. The Bright MLS rules for sold data are still open. */
const EMITTED_STATUSES = new Set<ListingDetailView['status']>(['Active', 'Coming Soon', 'Pending']);

export type JsonLdObject = Record<string, unknown>;

function offerFor(listing: ListingDetailView): JsonLdObject | null {
  // Only a home for sale or rent now is an Offer. Pending, Sold and off-market are not.
  if (!OFFER_STATUSES.has(listing.status) || listing.price === null) return null;
  const availability =
    listing.status === 'Coming Soon' ? 'https://schema.org/PreOrder' : 'https://schema.org/InStock';
  const base = { '@type': 'Offer', availability };
  if (listing.listingType === 'rent') {
    return {
      ...base,
      priceSpecification: {
        '@type': 'UnitPriceSpecification',
        price: listing.price,
        priceCurrency: 'USD',
        unitText: 'MONTH',
      },
    };
  }
  return { ...base, price: listing.price, priceCurrency: 'USD' };
}

function placeFor(listing: ListingDetailView): JsonLdObject {
  const unmasked = listing.address !== null;
  return {
    '@type': 'Place',
    name: shareHeading(listing),
    address: {
      '@type': 'PostalAddress',
      // A masked address carries no street, no ZIP and no coordinates.
      ...(unmasked ? { streetAddress: listing.address, postalCode: listing.zip } : {}),
      addressLocality: listing.city,
      addressRegion: listing.state,
      addressCountry: 'US',
    },
    ...(unmasked && listing.latitude !== null && listing.longitude !== null
      ? {
          geo: {
            '@type': 'GeoCoordinates',
            latitude: listing.latitude,
            longitude: listing.longitude,
          },
        }
      : {}),
  };
}

function agentFor(listing: ListingDetailView): JsonLdObject {
  const office = { '@type': 'Organization', name: listing.officeName };
  if (listing.listingAgentName === null) return office;
  return { '@type': 'RealEstateAgent', name: listing.listingAgentName, worksFor: office };
}

/**
 * The JSON-LD for a listing, or null when the row must emit none: a sample row, a row that is
 * not from Bright MLS, a listing past Pending, or a page with no origin to name its URLs.
 */
export function listingJsonLd(
  listing: ListingDetailView,
  origin: string | null,
): JsonLdObject | null {
  if (origin === null) return null;
  if (listing.isSample || listing.source !== 'brightMLS') return null;
  // A paid placement carries its label on the page. JSON-LD has no field for it, so it emits none.
  if (listing.sponsored) return null;
  if (!EMITTED_STATUSES.has(listing.status)) return null;

  const base = origin.replace(/\/$/, '');
  const url = `${base}${listing.propertyPath}`;
  const cityPath = searchPath(
    { kind: 'city', city: listing.city, state: listing.state },
    listing.listingType === 'rent' ? 'homes-for-rent' : 'homes-for-sale',
  );
  const offer = offerFor(listing);

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'RealEstateListing',
        '@id': `${url}#listing`,
        url,
        name: shareHeading(listing),
        datePosted: listing.listedAt ?? undefined,
        dateModified: listing.lastUpdated,
        about: placeFor(listing),
        provider: agentFor(listing),
        creditText: formatListingProvenance(listing.source) ?? undefined,
        publisher: { '@type': 'Organization', name: BRAND.brokerage },
        ...(offer ? { offers: offer } : {}),
        breadcrumb: { '@id': `${url}#breadcrumb` },
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${url}#breadcrumb`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: `${base}/` },
          {
            '@type': 'ListItem',
            position: 2,
            name: `${listing.city}, ${listing.state}`,
            item: `${base}${cityPath}`,
          },
          { '@type': 'ListItem', position: 3, name: shareHeading(listing), item: url },
        ],
      },
    ],
  };
}
