import axios from 'axios';
import {
  ATTRIBUTION_KEYS,
  type ListingCardRow,
  listingsEnvelopeSchema,
} from '@cribstop/property-contracts';
import { complianceFixtureIds } from './support/fixture-ids';

/**
 * `GET /listings` against a REAL service and REAL database, with the guarded compliance fixtures
 * loaded (see tests/support/fixtures.ts and tests/support/fixture-ids.ts for why this throws rather
 * than skipping when they are absent).
 *
 * Calling this at module scope means a missing/unparseable env var fails the whole file at
 * collection time — loudly, before a single test runs — rather than letting individual tests decide
 * whether to bother.
 */
const fixtures = complianceFixtureIds();

/**
 * Fixture rows coexist with the seed dataset and whatever else lives in the target database, so no
 * test in this file asserts an absolute `total`. Existence/absence is always checked by id within a
 * result set, paged through to completion rather than assumed to fit on page 1.
 */
async function fetchAllResults(
  params: Record<string, unknown> = {},
  pageSize = 100,
): Promise<ListingCardRow[]> {
  const all: ListingCardRow[] = [];
  let page = 1;
  for (;;) {
    const response = await axios.get('/listings', { params: { ...params, page, pageSize } });
    const envelope = listingsEnvelopeSchema.parse(response.data);
    all.push(...envelope.results);
    if (all.length >= envelope.total || envelope.results.length === 0) {
      return all;
    }
    page += 1;
  }
}

describe('suppressed address (address_display_allowed = false)', () => {
  it('stays present in results and counted in total, with address/latitude/longitude ALL null together — the opt-out is a mask on display, not a removal from the market', async () => {
    const results = await fetchAllResults();
    const row = results.find((result) => result.id === fixtures.suppressedAddressListingId);

    expect(row).toBeDefined();
    expect(row?.address).toBeNull();
    expect(row?.latitude).toBeNull();
    expect(row?.longitude).toBeNull();
  });

  it('is NOT returned by a street filter on the raw, unmasked street line — matching on it would hand the caller a confirmation oracle for the exact address the seller opted out of', async () => {
    const results = await fetchAllResults({ street: fixtures.suppressedAddressStreetLine });

    expect(results.some((result) => result.id === fixtures.suppressedAddressListingId)).toBe(false);
  });

  describe('free-text fields (#59)', () => {
    it('stores the street line in the title, description AND open-house remarks — otherwise everything below is vacuous', () => {
      // The scenario only exists if the fixture actually looks like feed-authored copy. A real MLS
      // title reads "142 Oak St — Colonial"; remarks read "entrance at the rear of 142".
      for (const stored of [
        fixtures.suppressedAddressStoredTitle,
        fixtures.suppressedAddressStoredDescription,
        fixtures.suppressedAddressStoredOpenHouseRemarks,
      ]) {
        expect(stored).toContain(fixtures.suppressedAddressStreetLine);
      }
    });

    it('is NOT matched by a free-text query for its street line, even though its stored title contains it — title is a `query` target, so an unconditioned title restores the exact confirmation oracle routing `street=` through the masked address was built to close', async () => {
      const results = await fetchAllResults({ query: fixtures.suppressedAddressStreetLine });

      expect(results.some((result) => result.id === fixtures.suppressedAddressListingId)).toBe(
        false,
      );
    });

    it('returns a substituted title carrying neither the street line nor the unit number, and never an empty one', async () => {
      const results = await fetchAllResults();
      const row = results.find((result) => result.id === fixtures.suppressedAddressListingId);

      expect(row).toBeDefined();
      expect(row?.title).not.toBe(fixtures.suppressedAddressStoredTitle);
      expect(row?.title).not.toContain(fixtures.suppressedAddressStreetLine);
      expect(row?.title).not.toContain(fixtures.suppressedAddressUnitNumber);
      // Substituted, NOT withheld — the contract's `title` is non-nullable and a card with no title
      // does not render.
      expect(row?.title.length).toBeGreaterThan(0);
    });

    it('keeps the upcoming open house but withholds its remarks — a time does not identify an address, so the opt-out masks the copy, not the showing', async () => {
      const results = await fetchAllResults({ openHouse: true });
      const row = results.find((result) => result.id === fixtures.suppressedAddressListingId);

      expect(row?.openHouse).not.toBeNull();
      expect(typeof row?.openHouse?.startsAt).toBe('string');
      expect(row?.openHouse?.remarks).toBeNull();
    });

    it('carries no part of the withheld address anywhere in its serialised card', async () => {
      // Whole-row, not field-by-field, for the same reason listing-search-view.e2e.spec.ts scans
      // the view's whole row: a card field added later that carried the street line would fail here
      // rather than needing someone to remember to assert it.
      const results = await fetchAllResults();
      const row = results.find((result) => result.id === fixtures.suppressedAddressListingId);

      expect(row).toBeDefined();
      const serialised = JSON.stringify(row);
      expect(serialised).not.toContain(fixtures.suppressedAddressStreetLine);
      expect(serialised).not.toContain(fixtures.suppressedAddressUnitNumber);
    });
  });
});

describe('suppressed listing (internet_display_allowed = false)', () => {
  it('is absent from results under every filter tried — the seller withheld the WHOLE listing, not just the address', async () => {
    const unfiltered = await fetchAllResults();
    const bySaleType = await fetchAllResults({ listingType: 'sale' });
    const byPropertyType = await fetchAllResults({ propertyType: 'Single Family' });

    for (const results of [unfiltered, bySaleType, byPropertyType]) {
      expect(results.some((result) => result.id === fixtures.suppressedListingId)).toBe(false);
    }
  });
});

describe('unapproved description (description_moderation = suppressed)', () => {
  it('is never returned by a query on a distinctive phrase from the withheld description — description is never a search field (PRD §6.3 keyword-based steering)', async () => {
    const distinctivePhrase = 'has not passed moderation and must never be returned';
    const results = await fetchAllResults({ query: distinctivePhrase });

    expect(results).toHaveLength(0);
  });

  it('never matches free-text query against description text even for a listing whose description IS approved', async () => {
    // "unremarkable" appears only in the (approved) description of the plain sample fixture — not in
    // its title, address, city, neighborhood or zip — so any match here could only have come from
    // matching the description, which the contract's search fields must never do.
    const wordOnlyInAnApprovedDescription = 'unremarkable';
    const results = await fetchAllResults({ query: wordOnlyInAnApprovedDescription });

    expect(results).toHaveLength(0);
  });
});

describe('non-consumer statuses (Withdrawn, Expired, Canceled, Hold)', () => {
  it('never appears in any result, under any filter — these feed statuses carry no consumer_status and must never reach a shopper', async () => {
    const unfiltered = await fetchAllResults();
    const byRent = await fetchAllResults({ listingType: 'rent' });
    const bySale = await fetchAllResults({ listingType: 'sale' });

    for (const results of [unfiltered, byRent, bySale]) {
      const ids = new Set(results.map((result) => result.id));
      for (const nonConsumerId of Object.values(fixtures.nonConsumerStatusListingIds)) {
        expect(ids.has(nonConsumerId)).toBe(false);
      }
    }
  });
});

describe('land parcel (NULL beds/baths/sqft, non-null lot_sqft)', () => {
  it('is excluded by beds=1, by baths=1 and by minSqft=1 — NULL fails the predicate, there is no COALESCE and no zero substitution', async () => {
    const excludedByBeds = await fetchAllResults({ beds: 1 });
    const excludedByBaths = await fetchAllResults({ baths: 1 });
    const excludedBySqft = await fetchAllResults({ minSqft: 1 });

    for (const results of [excludedByBeds, excludedByBaths, excludedBySqft]) {
      expect(results.some((result) => result.id === fixtures.landParcelListingId)).toBe(false);
    }
  });

  it('is present when those filters are absent, carrying propertyType Land, a non-null lotSqft, and null beds/baths/sqft', async () => {
    const results = await fetchAllResults();
    const row = results.find((result) => result.id === fixtures.landParcelListingId);

    expect(row).toBeDefined();
    expect(row?.propertyType).toBe('Land');
    expect(row?.lotSqft).toBe(fixtures.landParcelLotSqft);
    expect(row?.beds).toBeNull();
    expect(row?.baths).toBeNull();
    expect(row?.sqft).toBeNull();
  });
});

describe('sold gate (listingType=all excludes sold; listingType=sold requires a close date)', () => {
  it('excludes BOTH sold fixtures under listingType=all and under the default (no listingType param)', async () => {
    const defaulted = await fetchAllResults();
    const explicitlyAll = await fetchAllResults({ listingType: 'all' });

    for (const results of [defaulted, explicitlyAll]) {
      const ids = new Set(results.map((result) => result.id));
      expect(ids.has(fixtures.soldWithCloseDateListingId)).toBe(false);
      expect(ids.has(fixtures.soldWithoutCloseDateListingId)).toBe(false);
    }
  });

  it('listingType=sold returns the row WITH a close date and NEVER the row without one — a closed listing missing close_date is not publishable', async () => {
    const results = await fetchAllResults({ listingType: 'sold' });
    const ids = new Set(results.map((result) => result.id));

    expect(ids.has(fixtures.soldWithCloseDateListingId)).toBe(true);
    expect(ids.has(fixtures.soldWithoutCloseDateListingId)).toBe(false);
  });

  it('the publishable sold row carries closePrice AND closeDate alongside price, with closePrice different from price — rendering the ask as the sale price would misrepresent the transaction', async () => {
    const results = await fetchAllResults({ listingType: 'sold' });
    const row = results.find((result) => result.id === fixtures.soldWithCloseDateListingId);

    expect(row).toBeDefined();
    expect(row?.price).not.toBeNull();
    expect(row?.closePrice).not.toBeNull();
    expect(row?.closeDate).not.toBeNull();
    expect(row?.closePrice).not.toBe(row?.price);
  });
});

describe('openHouse=true (soonest UPCOMING occurrence only)', () => {
  it('matches an open house running RIGHT NOW — the bound is ends_at > now(), deliberately not starts_at > now(), because excluding an in-progress showing is the more visible bug', async () => {
    const results = await fetchAllResults({ openHouse: true });
    const ids = new Set(results.map((result) => result.id));

    expect(ids.has(fixtures.inProgressOpenHouseListingId)).toBe(true);
  });

  it('does NOT match an occurrence that has already ended, nor one that was cancelled even though its times are still upcoming', async () => {
    const results = await fetchAllResults({ openHouse: true });
    const ids = new Set(results.map((result) => result.id));

    expect(ids.has(fixtures.pastOpenHouseListingId)).toBe(false);
    expect(ids.has(fixtures.cancelledOpenHouseListingId)).toBe(false);
  });

  it('carries a non-null openHouse object with startsAt/endsAt/remarks, and no hasOpenHouse key anywhere in the payload — there is deliberately no unbounded boolean badge', async () => {
    const response = await axios.get('/listings', { params: { openHouse: true, pageSize: 100 } });
    const raw = response.data as unknown;
    const envelope = listingsEnvelopeSchema.parse(raw);
    const row = envelope.results.find(
      (result) => result.id === fixtures.inProgressOpenHouseListingId,
    );

    expect(row?.openHouse).not.toBeNull();
    expect(typeof row?.openHouse?.startsAt).toBe('string');
    expect(typeof row?.openHouse?.endsAt).toBe('string');
    expect(row?.openHouse).toHaveProperty('remarks');
    expect(JSON.stringify(raw)).not.toContain('hasOpenHouse');
  });
});

describe('pagination is a total order', () => {
  const SORTS = ['recommended', 'newest', 'price-asc', 'price-desc'] as const;
  // Small enough to force at least two pages against the seed-plus-fixture dataset, without
  // depending on (or asserting) any particular absolute count.
  const PAGE_SIZE = 5;

  it.each(SORTS)(
    'gives page 1 and page 2 the SAME total and NO shared ids for sort=%s — a sort with no id tiebreaker repeats rows across pages and makes total meaningless',
    async (sort) => {
      const page1 = listingsEnvelopeSchema.parse(
        (await axios.get('/listings', { params: { sort, page: 1, pageSize: PAGE_SIZE } })).data,
      );
      const page2 = listingsEnvelopeSchema.parse(
        (await axios.get('/listings', { params: { sort, page: 2, pageSize: PAGE_SIZE } })).data,
      );

      expect(page2.total).toBe(page1.total);
      const page1Ids = new Set(page1.results.map((result) => result.id));
      for (const result of page2.results) {
        expect(page1Ids.has(result.id)).toBe(false);
      }
    },
  );

  it('returns 200 with an empty results array and the SAME total for a page far past the end — never a 404', async () => {
    const first = listingsEnvelopeSchema.parse(
      (await axios.get('/listings', { params: { page: 1, pageSize: 20 } })).data,
    );
    const response = await axios.get('/listings', {
      params: { page: 9999, pageSize: 20 },
      validateStatus: () => true,
    });

    expect(response.status).toBe(200);
    const farPage = listingsEnvelopeSchema.parse(response.data);
    expect(farPage.results).toEqual([]);
    expect(farPage.total).toBe(first.total);
  });
});

describe('attribution (NAR 7.58 / PRD §6.2) applies to search results, not only detail', () => {
  const FILTER_COMBINATIONS: Record<string, unknown>[] = [
    {},
    { listingType: 'sold' },
    { openHouse: true },
    { beds: 1 },
    { query: 'Fixture' },
    { sort: 'price-desc' },
  ];

  it.each(FILTER_COMBINATIONS)(
    'every row carries all ATTRIBUTION_KEYS with non-empty brokerName/officeName/listedBy for filters %j',
    async (params) => {
      const results = await fetchAllResults(params);
      expect(results.length).toBeGreaterThan(0);
      for (const row of results) {
        for (const key of ATTRIBUTION_KEYS) {
          expect(row).toHaveProperty(key);
        }
        expect(row.brokerName.length).toBeGreaterThan(0);
        expect(row.officeName.length).toBeGreaterThan(0);
        expect(row.listedBy.length).toBeGreaterThan(0);
      }
    },
  );
});

describe('no per-user state in search results', () => {
  it("never includes isSaved or isFavorited on any row — a per-user field here would make every search response uncacheable and is #23/#25's job, not this one's", async () => {
    const results = await fetchAllResults();
    for (const row of results) {
      expect(row).not.toHaveProperty('isSaved');
      expect(row).not.toHaveProperty('isFavorited');
    }
  });
});

describe('sponsored disclosure (#24 not yet built)', () => {
  it('is never true on any row, across EVERY page of the default search — paid placement with no renderable label would be an undisclosed sponsorship', async () => {
    // A small page size forces this to page through more than one request, which is what makes the
    // "across every page" part of the assertion real rather than a one-shot check against page 1.
    const results = await fetchAllResults({}, 5);
    expect(results.length).toBeGreaterThan(0);
    for (const row of results) {
      expect(row.sponsored).not.toBe(true);
    }
  });
});

describe('list rows never carry description', () => {
  it('has no description key on any card row — description is the field with the most Fair Housing steering risk and does not belong on the widest, most-cached surface', async () => {
    const results = await fetchAllResults();
    for (const row of results) {
      expect(row).not.toHaveProperty('description');
    }
  });
});

describe('strict parsing rejects unknown/out-of-range parameters with 400', () => {
  it.each([
    ['an unknown parameter (typo protection)', { bed: 3 }],
    ['a field-selection attempt', { fields: 'id' }],
    ['a pageSize above the documented maximum', { pageSize: 101 }],
    ['a page of zero', { page: 0 }],
    ['an unknown sort value', { sort: 'nearest' }],
    ['an amenity outside the closed 15-value set', { amenities: 'Helipad' }],
  ])('rejects %s with an invalid_request body', async (_label, params) => {
    const response = await axios.get('/listings', { params, validateStatus: () => true });

    expect(response.status).toBe(400);
    expect(response.data).toMatchObject({ error: { code: 'invalid_request' } });
  });
});

describe('cache headers', () => {
  it('sets Cache-Control to exactly "public, max-age=60" and never no-store — these payloads carry no PII and embed a time-relative fact (the upcoming open house), which caps the TTL but must not force the response uncacheable', async () => {
    const response = await axios.get('/listings');

    expect(response.headers['cache-control']).toBe('public, max-age=60');
    expect(response.headers['cache-control']).not.toContain('no-store');
  });
});
