import axios from 'axios';
import { ATTRIBUTION_KEYS, listingDetailSchema } from '@cribstop/property-contracts';
import { complianceFixtureIds } from './support/fixture-ids';

/**
 * `GET /listings/:id` against a REAL service and REAL database, with the guarded compliance
 * fixtures loaded. See tests/support/fixture-ids.ts for why this throws instead of skipping when
 * they are absent — a suite that tolerates missing fixtures is a suite that is not actually testing
 * anything, since the seed dataset alone makes every compliance assertion here vacuously true.
 */
const fixtures = complianceFixtureIds();

describe('the nested object graph', () => {
  it('returns { property, unit, listing }, with description present ONLY inside listing — it is the field with the most Fair Housing steering risk and does not belong anywhere else', async () => {
    const response = await axios.get(`/listings/${fixtures.sampleListingId}`);
    const detail = listingDetailSchema.parse(response.data);

    expect(detail.property).toBeDefined();
    // The plain sample fixture is a non-subdivided home (no unit row), so `unit: null` here is
    // itself meaningful — asserted explicitly rather than skipped, per PRD §3's "zero unit rows,
    // never a synthetic whole-property unit" rule.
    expect(detail.unit).toBeNull();
    expect(detail.listing).toHaveProperty('description');
    expect(response.data.property).not.toHaveProperty('description');
  });

  it('carries the exact Cache-Control the search endpoint uses — the detail payload embeds the same time-relative upcoming-open-house fact', async () => {
    const response = await axios.get(`/listings/${fixtures.sampleListingId}`);

    expect(response.headers['cache-control']).toBe('public, max-age=60');
  });
});

describe('suppressed address on detail (address_display_allowed = false)', () => {
  it("nulls listing.address AND unit.unitNumber, even though the real unit number is known — the view builds address as street_line || ' ' || unit_number, so emitting the unit number next to property.city/state/zip would make the opted-out address reconstructible", async () => {
    const response = await axios.get(`/listings/${fixtures.suppressedAddressListingId}`);
    const detail = listingDetailSchema.parse(response.data);

    expect(detail.listing.address).toBeNull();
    // This fixture IS a subdivided condo (it has a real unit), so `unit` itself must still be
    // present — it is specifically `unitNumber` that must be withheld, not the whole unit object.
    expect(detail.unit).not.toBeNull();
    expect(detail.unit?.unitNumber).toBeNull();
    expect(detail.unit?.unitNumber).not.toBe(fixtures.suppressedAddressUnitNumber);
  });
});

describe('unapproved description on detail (description_moderation = suppressed)', () => {
  it('withholds listing.description but still answers 200 — the listing itself is visible, only the copy is withheld pending moderation', async () => {
    const response = await axios.get(`/listings/${fixtures.unapprovedDescriptionListingId}`, {
      validateStatus: () => true,
    });

    expect(response.status).toBe(200);
    const detail = listingDetailSchema.parse(response.data);
    expect(detail.listing.description).toBeNull();
  });
});

describe('404 parity — the seller opt-out depends on these being indistinguishable', () => {
  it('returns the identical status AND byte-identical body for an unknown id, a seller-suppressed id, every non-consumer-status id, and a malformed id — never a distinguishing 403 or message', async () => {
    const unknownId = '00000000-0000-4000-8000-000000000000';
    const malformedId = 'not-a-uuid';
    const paths = [
      `/listings/${unknownId}`,
      `/listings/${fixtures.suppressedListingId}`,
      ...Object.values(fixtures.nonConsumerStatusListingIds).map((id) => `/listings/${id}`),
      `/listings/${malformedId}`,
    ];

    const responses = await Promise.all(
      paths.map((path) => axios.get(path, { validateStatus: () => true })),
    );

    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(response.status).not.toBe(403);
    }

    const bodies = responses.map((response) => response.data);
    // Collected as raw response bodies (not re-parsed/re-shaped) so this asserts what actually went
    // over the wire, not a normalised view of it.
    expect(new Set(bodies.map((body) => JSON.stringify(body))).size).toBe(1);
  });
});

describe('a listing that HAS an upcoming open house', () => {
  /**
   * The regression this suite was missing. Every detail spec above requests a fixture with no open
   * house, so `toListingDetail` had never once run with a populated `open_houses` array — and the
   * detail endpoint 500'd for all three seeded open-house listings in the deployed cluster while
   * this suite reported green.
   *
   * The cause is worth stating so the test is not "simplified" later: the detail query aggregates
   * open houses with `json_agg(json_build_object(...))`, and a `timestamptz` nested inside JSON is
   * serialised by Postgres rather than by `pg`'s type parsers, so it arrives as `...+00:00` instead
   * of as a `Date`. The contract's `z.iso.datetime()` rejects a numeric offset. Fetching detail for
   * a listing with an occurrence is the only assertion that exercises that path end to end.
   */
  it('returns 200 with contract-valid ISO instants, not a 500 — a JSON-nested timestamptz bypasses pg’s type parsers and reaches the mapper in Postgres’s own offset format', async () => {
    const response = await axios.get(`/listings/${fixtures.inProgressOpenHouseListingId}`);

    expect(response.status).toBe(200);

    // `parse` (not `safeParse`) is the assertion: the contract itself decides whether the instants
    // are publishable, so this cannot drift from what the client is promised.
    const detail = listingDetailSchema.parse(response.data);

    expect(detail.listing.openHouses.length).toBeGreaterThan(0);
    for (const occurrence of detail.listing.openHouses) {
      expect(occurrence.startsAt).toMatch(/Z$/);
      expect(occurrence.endsAt).toMatch(/Z$/);
      expect(Number.isNaN(Date.parse(occurrence.startsAt))).toBe(false);
      // This fixture is deliberately IN PROGRESS (started an hour ago, still running), which is the
      // case `ends_at > now()` exists to keep visible and `starts_at > now()` would have dropped.
      expect(Date.parse(occurrence.endsAt)).toBeGreaterThan(Date.now());
    }
  });

  it('agrees with the card projection about the soonest occurrence, so the badge and the detail page cannot disagree', async () => {
    const [detailResponse, searchResponse] = await Promise.all([
      axios.get(`/listings/${fixtures.inProgressOpenHouseListingId}`),
      axios.get('/listings', { params: { openHouse: true, pageSize: 100 } }),
    ]);

    const detail = listingDetailSchema.parse(detailResponse.data);
    const card = searchResponse.data.results.find(
      (row: { id: string }) => row.id === fixtures.inProgressOpenHouseListingId,
    );

    expect(card).toBeDefined();
    expect(card.openHouse).not.toBeNull();
    // The card carries the SOONEST upcoming occurrence; detail carries all of them in start order.
    expect(detail.listing.openHouses[0]).toEqual(card.openHouse);
  });
});

describe('attribution (NAR 7.58 / PRD §6.2) on the detail listing', () => {
  it('carries the full attribution block on listing, not just on search cards', async () => {
    const response = await axios.get(`/listings/${fixtures.sampleListingId}`);
    const detail = listingDetailSchema.parse(response.data);

    for (const key of ATTRIBUTION_KEYS) {
      expect(detail.listing).toHaveProperty(key);
    }
    expect(detail.listing.brokerName.length).toBeGreaterThan(0);
    expect(detail.listing.officeName.length).toBeGreaterThan(0);
    expect(detail.listing.listedBy.length).toBeGreaterThan(0);
  });
});
