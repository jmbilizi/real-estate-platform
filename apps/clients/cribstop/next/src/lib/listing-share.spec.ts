import { BRAND } from '@/lib/brand';
import {
  buildListingShare,
  listingPath,
  listingShareUrl,
  SAMPLE_SHARE_LABEL,
  type ShareableListing,
  shareHeading,
  SPONSORED_SHARE_LABEL,
} from '@/lib/listing-share';

function aShareable(overrides: Partial<ShareableListing> = {}): ShareableListing {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    address: '100 Test St',
    city: 'Bethesda',
    state: 'MD',
    zip: '20814',
    neighborhood: 'Downtown',
    isSample: false,
    sponsored: false,
    source: 'internal',
    listedBy: 'Jane Q. Agent – Bright Partner Realty',
    ...overrides,
  };
}

describe('listingShareUrl', () => {
  it('is the canonical listing route, not the current address bar', () => {
    const url = listingShareUrl('abc-123', 'https://example.com');
    expect(url).toBe('https://example.com/listing/abc-123');
  });

  it('tolerates a trailing slash on the origin', () => {
    expect(listingShareUrl('abc', 'https://example.com/')).toBe('https://example.com/listing/abc');
  });

  it('encodes the id', () => {
    expect(listingPath('a b/c')).toBe('/listing/a%20b%2Fc');
  });
});

describe('shareHeading — address suppression', () => {
  it('uses the street address when the service sent one', () => {
    expect(shareHeading(aShareable())).toBe('100 Test St, Bethesda, MD 20814');
  });

  it('never names a street for a row whose address the service masked', () => {
    const heading = shareHeading(aShareable({ address: null }));

    expect(heading).toBe('Downtown, Bethesda');
    expect(heading).not.toContain('100 Test St');
    expect(heading).not.toContain('20814');
  });

  it('falls back to city and state when the neighbourhood is unknown too', () => {
    expect(shareHeading(aShareable({ address: null, neighborhood: null }))).toBe('Bethesda, MD');
  });
});

describe('buildListingShare', () => {
  const URL_ = 'https://example.com/listing/11111111-1111-4111-8111-111111111111';

  it('carries the canonical URL and the row’s own attribution', () => {
    const share = buildListingShare(aShareable(), URL_);

    expect(share.title).toBe('100 Test St, Bethesda, MD 20814');
    expect(share.text).toContain('Listed by Jane Q. Agent – Bright Partner Realty.');
    expect(share.url).toBe(URL_);
  });

  it('names the brokerage ahead of the site, and as the operator of the site', () => {
    const { text } = buildListingShare(aShareable(), URL_);

    expect(text).toContain(`${BRAND.brokerage} operates ${BRAND.siteDomain}.`);
    expect(text.indexOf(BRAND.brokerage)).toBeLessThan(text.indexOf(BRAND.siteDomain));
    // A third party listed this home. Nothing may say our brokerage did, or that it came from us.
    expect(text).not.toMatch(/Brokered by Real Broker|From Real Broker/);
  });

  it('discloses a paid placement in both the title and the text', () => {
    const share = buildListingShare(aShareable({ sponsored: true }), URL_);

    expect(share.title).toContain('Sponsored');
    expect(share.text).toContain(SPONSORED_SHARE_LABEL);
  });

  it('leads with the disclosures, which a truncating share sheet keeps', () => {
    const { text } = buildListingShare(aShareable({ isSample: true, sponsored: true }), URL_);

    expect(text.startsWith(SAMPLE_SHARE_LABEL)).toBe(true);
    expect(text.indexOf(SPONSORED_SHARE_LABEL)).toBeLessThan(text.indexOf('Listed by'));
  });

  it('claims no MLS provenance for a row we hold ourselves', () => {
    const share = buildListingShare(aShareable({ source: 'internal' }), URL_);

    expect(`${share.title} ${share.text}`).not.toMatch(/\bMLS\b/i);
    expect(share.text).toContain('Listing information provided by Cribstop.com.');
  });

  it('carries the Bright IDX line for a row Bright supplied', () => {
    const share = buildListingShare(aShareable({ source: 'brightMLS' }), URL_);

    expect(share.text).toContain('Information provided by Bright MLS.');
  });

  it('claims neither provenance for a row from a third source', () => {
    const share = buildListingShare(aShareable({ source: 'other' }), URL_);

    expect(share.text).not.toMatch(/\bMLS\b|provided by/i);
  });

  it('labels a sample row as sample data in both the title and the text', () => {
    const share = buildListingShare(aShareable({ isSample: true }), URL_);

    expect(share.title).toContain('Sample listing');
    expect(share.text).toContain(SAMPLE_SHARE_LABEL);
  });

  it('leaks no masked address into the share text', () => {
    const share = buildListingShare(aShareable({ address: null, isSample: true }), URL_);

    expect(`${share.title} ${share.text}`).not.toContain('100 Test St');
    expect(`${share.title} ${share.text}`).not.toContain('20814');
  });
});
