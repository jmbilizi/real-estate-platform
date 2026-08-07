import { mockListings } from './mock-listings';
import { mapToListingRow } from './transform';

/**
 * Compliance guards on the seed dataset itself (PRD §6.2/§6.3).
 *
 * These assert properties of the *data file*, not of `transform.ts`. That
 * distinction is the point: anything importing `mockListings` directly — a
 * contract-test fixture, a local API stub — bypasses the transform, so the
 * data has to be correct on its own.
 */
describe('mock-listings compliance', () => {
  it('never claims MLS provenance', () => {
    const mlsSourced = mockListings.filter((listing) => listing.source !== 'internal');
    expect(mlsSourced).toEqual([]);
  });

  it('labels every listing as sample data in its title', () => {
    const unlabelled = mockListings
      .filter((listing) => !listing.title.endsWith('(Sample)'))
      .map((listing) => listing.title);
    expect(unlabelled).toEqual([]);
  });

  it('attributes every listing to our own brokerage, never a third party', () => {
    const offices = [...new Set(mockListings.map((listing) => listing.officeName))];
    expect(offices).toEqual(['Real Broker, LLC']);
  });

  it('uses only RFC 2606 reserved example.com mailboxes', () => {
    const realDomains = mockListings
      .flatMap((listing) => [listing.brokerEmail, listing.officeBrokerLeadMail])
      .filter((email): email is string => Boolean(email))
      .filter((email) => !email.endsWith('@example.com'));
    expect(realDomains).toEqual([]);
  });

  it('uses only reserved 555-01xx phone numbers', () => {
    const realNumbers = mockListings
      .flatMap((listing) => [listing.brokerPhone, listing.officeBrokerLeadPhone])
      .filter((phone): phone is string => Boolean(phone))
      .filter((phone) => !/^\(\d{3}\) 555-01\d{2}$/.test(phone));
    expect(realNumbers).toEqual([]);
  });

  it('keeps Fair Housing steering proxies out of listing copy', () => {
    // School-quality claims are the canonical HUD/DOJ steering proxy for race
    // and familial status; the rest are common demographic / "who should live
    // here" signals. Property-type taxonomy ("Single Family") and room types
    // ("family room") are deliberately not matched.
    const steering =
      /\bschools?\b|\bfamily home\b|\bsafe\b|\bchurch\b|\bsynagogue\b|\bmosque\b|\bexclusive\b|\bno kids\b|\bperfect for families\b/i;
    const offenders = mockListings
      .filter((listing) => steering.test(`${listing.title} ${listing.description}`))
      .map((listing) => listing.title);
    expect(offenders).toEqual([]);
  });

  it('carries the required attribution block on every listing', () => {
    const missing = mockListings
      .filter(
        (listing) =>
          !listing.brokerName ||
          !listing.brokerPhone ||
          !listing.brokerEmail ||
          !listing.officeName,
      )
      .map((listing) => listing.title);
    expect(missing).toEqual([]);
  });

  it('produces internal, sample-flagged rows for the whole dataset', () => {
    const rows = mockListings.map((listing, index) =>
      mapToListingRow(`listing-${index}`, `property-${index}`, null, listing),
    );
    expect(rows).toHaveLength(mockListings.length);
    expect(rows.every((row) => row.source === 'internal')).toBe(true);
    expect(rows.every((row) => row.is_sample)).toBe(true);
  });
});
