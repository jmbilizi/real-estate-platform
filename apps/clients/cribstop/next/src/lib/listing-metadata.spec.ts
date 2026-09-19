import type { ListingDetail } from '@cribstop/property-contracts';
import { toListingDetailView } from '@/lib/api/listings';
import { PRICE_WITHHELD_COPY } from '@/lib/listing-format';
import { listingMetadata, unresolvedListingMetadata } from '@/lib/listing-metadata';
import { aListingDetail } from '@/test/fixtures';

const ORIGIN = 'https://example.com';

function metaFor(listing: Partial<ListingDetail['listing']>) {
  return listingMetadata(toListingDetailView(aListingDetail({ listing })), ORIGIN);
}

/** Everything a crawler would read out of one `Metadata` object, as one string. */
function publishedText(meta: ReturnType<typeof listingMetadata>): string {
  return [
    meta.title,
    meta.description,
    meta.openGraph?.title,
    meta.openGraph?.description,
    meta.twitter?.title,
    meta.twitter?.description,
  ]
    .filter(Boolean)
    .join(' ');
}

describe('listingMetadata — canonical URL', () => {
  it('points at the canonical listing route on the requesting origin', () => {
    const meta = metaFor({ id: 'abc-123' });

    expect(meta.alternates?.canonical).toBe(`${ORIGIN}/listing/abc-123`);
    expect(meta.openGraph?.url).toBe(`${ORIGIN}/listing/abc-123`);
  });
});

describe('listingMetadata — brand prominence', () => {
  it('names the brokerage in the title and as the Open Graph site name', () => {
    const meta = metaFor({});

    expect(meta.title).toContain('Real Broker, LLC');
    expect(meta.openGraph?.siteName).toBe('Real Broker, LLC');
  });
});

describe('listingMetadata — suppression is never undone by a preview', () => {
  it('publishes no street address for a row whose address the service masked', () => {
    const meta = metaFor({
      address: null,
      latitude: null,
      longitude: null,
      title: '742 Evergreen Terrace — Waterfront Penthouse',
      description: 'Walk out of 742 Evergreen Terrace onto the pier.',
    });

    expect(publishedText(meta)).not.toContain('742 Evergreen Terrace');
  });

  it('states a withheld price as withheld rather than as a number', () => {
    const meta = metaFor({ price: null });

    expect(meta.description).toContain(PRICE_WITHHELD_COPY);
    expect(meta.description).not.toMatch(/\$\d/);
  });

  it('adds no image when the service sent no media', () => {
    const meta = metaFor({ media: [] });

    expect(meta.openGraph?.images).toBeUndefined();
    expect(meta.twitter?.images).toBeUndefined();
  });

  it('carries no alt text the service did not send', () => {
    const meta = metaFor({
      media: [{ url: 'https://example.com/a.jpg', altText: null }],
    });

    expect(meta.openGraph?.images).toEqual([{ url: 'https://example.com/a.jpg', alt: undefined }]);
  });
});

describe('listingMetadata — provenance', () => {
  it('labels a sample row as sample data', () => {
    expect(publishedText(metaFor({ isSample: true }))).toContain('Sample data');
  });

  it('claims no MLS provenance', () => {
    expect(publishedText(metaFor({ isSample: true }))).not.toMatch(/MLS|Bright/i);
  });
});

describe('unresolvedListingMetadata', () => {
  it('does not publish a dead link, and names no listing', () => {
    const meta = unresolvedListingMetadata();

    expect(meta.robots).toEqual({ index: false });
    expect(meta.title).toContain('Real Broker, LLC');
  });
});
