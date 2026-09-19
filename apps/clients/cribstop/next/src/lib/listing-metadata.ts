import type { Metadata } from 'next';
import type { ListingDetailView } from '@/lib/api/listings';
import { BRAND } from '@/lib/brand';
import { formatDwellingStats, formatListingPrice } from '@/lib/listing-format';
import { listingPath, SAMPLE_SHARE_LABEL, shareHeading } from '@/lib/listing-share';

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
  const heading = shareHeading(listing);
  const title = `${heading} · ${BRAND.brokerage}`;

  const facts = [
    formatListingPrice(listing.price, listing.listingType).text,
    formatDwellingStats(listing.beds, listing.baths, listing.sqft),
    listing.propertyType,
  ].filter(Boolean);

  const description = [
    `${facts.join(' · ')}.`,
    `Brokered by ${BRAND.brokerage}.`,
    ...(listing.isSample ? [SAMPLE_SHARE_LABEL] : []),
  ].join(' ');

  /*
   * The gallery as the service returned it. Suppression is applied upstream — a row whose alt text
   * would have re-identified a masked address already arrives with `altText: null` — so the only
   * rule left here is to add nothing the service did not send.
   */
  const preview = listing.media[0];
  const url = `${origin.replace(/\/$/, '')}${listingPath(listing.id)}`;

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
 * What a listing that did not resolve unfurls into: the site default, and `noindex` so a dead or
 * withdrawn link never publishes an error message as a preview card.
 */
export function unresolvedListingMetadata(): Metadata {
  return { title: `${BRAND.brokerage} — ${BRAND.titleSuffix}`, robots: { index: false } };
}
