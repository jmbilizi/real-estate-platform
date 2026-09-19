import type { ListingDetail } from '@cribstop/property-contracts';
import { toListingDetailView } from '@/lib/api/listings';
import { PRICE_WITHHELD_COPY } from '@/lib/listing-format';
import { listingMetadata, unresolvedListingMetadata } from '@/lib/listing-metadata';
import { SAMPLE_SHARE_LABEL, SPONSORED_SHARE_LABEL } from '@/lib/listing-share';
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
  it('points at the canonical listing route on the configured origin', () => {
    const meta = metaFor({ id: 'abc-123' });

    expect(meta.alternates?.canonical).toBe(`${ORIGIN}/listing/abc-123`);
    expect(meta.openGraph?.url).toBe(`${ORIGIN}/listing/abc-123`);
  });

  it('publishes no canonical URL at all when no origin is vouched for', () => {
    const meta = listingMetadata(toListingDetailView(aListingDetail()), null);

    expect(meta.alternates).toBeUndefined();
    expect(meta.openGraph?.url).toBeUndefined();
  });
});

describe('listingMetadata — attribution', () => {
  it('names the brokerage in the title and as the Open Graph site name', () => {
    const meta = metaFor({});

    expect(meta.title).toContain('Real Broker, LLC');
    expect(meta.openGraph?.siteName).toBe('Real Broker, LLC');
  });

  it('attributes the listing to its own listing office, not to our brokerage', () => {
    const meta = metaFor({ listedBy: 'Jane Q. Agent – Bright Partner Realty' });

    expect(meta.description).toContain('Listed by Jane Q. Agent – Bright Partner Realty.');
    expect(meta.description).not.toMatch(/Brokered by Real Broker/);
  });
});

describe('listingMetadata — the preview must not contradict the page', () => {
  it('shows a closed sale at its close price, and says Sold exactly once', () => {
    const description =
      metaFor({ status: 'Sold', price: 750000, closePrice: 712000, closeDate: '2026-03-04' })
        .description ?? '';

    expect(description).toContain('Sold for $712,000');
    expect(description).not.toContain('$750,000');
    expect(description.match(/Sold/g)).toHaveLength(1);
  });

  it('names a Pending status and keeps the asking price', () => {
    const description = metaFor({ status: 'Pending', price: 750000 }).description ?? '';

    expect(description).toContain('Pending');
    expect(description).toContain('$750,000');
  });

  it('adds no status word for an active listing', () => {
    expect(metaFor({ status: 'Active' }).description).not.toContain('Active');
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

describe('listingMetadata — required labels survive truncation', () => {
  it('labels a sample row in the title, which a compact unfurl shows alone', () => {
    const meta = metaFor({ isSample: true });

    expect(meta.openGraph?.title).toContain('Sample listing');
    expect(meta.description?.startsWith(SAMPLE_SHARE_LABEL)).toBe(true);
  });

  it('discloses a paid placement ahead of the listing facts', () => {
    const description = metaFor({ sponsored: true }).description ?? '';

    expect(description).toContain(SPONSORED_SHARE_LABEL);
    expect(description.indexOf(SPONSORED_SHARE_LABEL)).toBeLessThan(
      description.indexOf('Listed by'),
    );
  });

  it('puts every owed sentence ahead of the optional facts, which a truncated card may lose', () => {
    const description = metaFor({ source: 'brightMLS', isSample: true, sponsored: true })
      .description as string;
    const facts = description.indexOf('3 bd');

    for (const owed of [
      SAMPLE_SHARE_LABEL,
      SPONSORED_SHARE_LABEL,
      'Real Broker, LLC operates',
      'Information provided by Bright MLS.',
      'Listed by',
    ]) {
      expect(description.indexOf(owed)).toBeLessThan(facts);
    }
  });

  it('keeps a sample row out of the search index', () => {
    expect(metaFor({ isSample: true }).robots).toEqual({ index: false });
    expect(metaFor({ isSample: false }).robots).toBeUndefined();
  });

  it('claims no MLS provenance for a row we hold ourselves', () => {
    expect(publishedText(metaFor({ source: 'internal', isSample: true }))).not.toMatch(/\bMLS\b/i);
  });

  it('carries the Bright IDX line for a row Bright supplied', () => {
    expect(metaFor({ source: 'brightMLS' }).description).toContain(
      'Information provided by Bright MLS.',
    );
  });
});

describe('unresolvedListingMetadata', () => {
  it('asks a crawler to drop a listing that is genuinely gone', () => {
    expect(unresolvedListingMetadata({ noindex: true }).robots).toEqual({ index: false });
  });

  it('does not de-index a live URL after a transient failure', () => {
    const meta = unresolvedListingMetadata({ noindex: false });

    expect(meta.robots).toBeUndefined();
    expect(meta.title).toContain('Real Broker, LLC');
  });
});
