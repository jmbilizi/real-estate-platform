import type { Metadata } from 'next';
import type { ListingDetailView } from '@/lib/api/listings';
import { BRAND } from '@/lib/brand';
import { formatClosePrice, formatDwellingStats, formatListingPrice } from '@/lib/listing-format';
import { listingShareUrl, shareDisclosures, shareTitle } from '@/lib/listing-share';

/**
 * Link-preview metadata for a shared listing.
 *
 * An unfurl is a publication, so every rule the listing page obeys applies here. The text is
 * composed by `lib/listing-share` and `lib/listing-format`, never assembled from raw fields: a
 * masked address stays masked, a withheld price reads as withheld, and a sample row says it is a
 * sample. The feed's `title` and `description` are deliberately unused — address suppression does
 * not reach them (#59), and a preview card outlives the page it was cut from.
 */
export function listingMetadata(listing: ListingDetailView, origin: string): Metadata {
  const title = `${shareTitle(listing)} · ${BRAND.brokerage}`;

  /*
   * A closed sale shows what it closed at, and anything that is not Active says so. The preview
   * card outlives the moment it was cut, so a Sold home previewed at its ask as though it were on
   * the market contradicts the page it links to for as long as the card is cached.
   */
  const closed = formatClosePrice(listing.closePrice, listing.closeDate);

  const facts = [
    ...(listing.status === 'Active' ? [] : [listing.status]),
    closed ?? formatListingPrice(listing.price, listing.listingType).text,
    formatDwellingStats(listing.beds, listing.baths, listing.sqft),
    listing.propertyType,
  ].filter(Boolean);

  const description = [
    ...shareDisclosures(listing),
    `${facts.join(' · ')}.`,
    `Listed by ${listing.listedBy}.`,
    `From ${BRAND.brokerage} on ${BRAND.siteDomain}.`,
  ].join(' ');

  /*
   * The gallery as the service returned it. Suppression is applied upstream — a row whose alt text
   * would have re-identified a masked address already arrives with `altText: null` — so the only
   * rule left here is to add nothing the service did not send.
   */
  const preview = listing.media[0];
  // The same URL the Share button copies. The two must not be able to disagree.
  const url = listingShareUrl(listing.id, origin);

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      siteName: BRAND.brokerage,
      title,
      description,
      url,
      images: preview ? [{ url: preview.url, alt: preview.altText ?? undefined }] : undefined,
    },
    twitter: {
      card: preview ? 'summary_large_image' : 'summary',
      title,
      description,
      images: preview ? [preview.url] : undefined,
    },
  };
}

/**
 * What a listing that did not resolve unfurls into: the site default, naming no home.
 *
 * `noindex` is for a listing that is genuinely gone. A transient gateway failure must not carry it
 * — the URL is still live, and de-indexing it would cost real traffic for a fault that lasted
 * seconds.
 */
export function unresolvedListingMetadata({ noindex }: { noindex: boolean }): Metadata {
  return {
    title: `${BRAND.brokerage} — ${BRAND.titleSuffix}`,
    ...(noindex ? { robots: { index: false } } : {}),
  };
}
