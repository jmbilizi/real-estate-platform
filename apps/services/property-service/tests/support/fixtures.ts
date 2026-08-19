/**
 * Guarded compliance fixtures for the Property API e2e suite (#22).
 *
 * The seed dataset (`src/seed/mock-listings.ts`) has zero suppressed addresses, zero suppressed
 * listings, zero unapproved descriptions, zero non-consumer statuses, zero `Land` rows and zero NULL
 * beds/baths/sqft. Every compliance assertion #22's e2e suite wants to make is therefore vacuously
 * true against the seed alone — this module is what gives those assertions something real to fail
 * against.
 *
 * THREE INDEPENDENT GUARDS, because any one of them alone is a single point of failure:
 *
 *  1. LOCATION (this file). `jest.config.ts` excludes `tests/` from `nx test` (and therefore from
 *     CI's `nx:node-test` sweep), webpack never bundles `tests/` into the service image, and
 *     `skaffold.yaml` excludes `tests/` from the image build context. A file that lives here cannot
 *     ship, full stop, regardless of what the other two guards do.
 *  2. OPT-IN. `assertFixturesEnabled()` throws unless `PROPERTY_SERVICE_E2E_FIXTURES === '1'`, and
 *     throws unconditionally when `NODE_ENV === 'production'` even if that flag is set.
 *     `loadComplianceFixtures()` calls it before opening a connection, let alone a transaction.
 *  3. SELF-LABELLING SHAPE. Every row this module writes is `is_sample = true`, titled with the
 *     `E2E Fixture` prefix and a `(Sample)` suffix, `source = 'internal'` (never `brightMLS` — this
 *     data was never an MLS feed and must never claim to be), attributed to the real brokerage (Real
 *     Broker, LLC — that attribution is compliance-correct, not fake), and reachable only through
 *     RFC 2606 `example.com` mailboxes, reserved `555-01xx` phone numbers and a street/city/state/zip
 *     that do not exist. A leaked row is unmistakable on sight.
 *
 * WRITER DISCIPLINE: `src/db/write.ts` is the only module that writes `listings`
 * (`src/seed/seed.spec.ts` asserts this), so every listing/property/unit/community row below goes
 * through its exported functions — `getOrCreateProperty()`, `getOrCreateUnit()`, `insertCommunity()`,
 * `insertOpenHouse()`, `upsertListing()`. This module never issues a raw INSERT/UPDATE against
 * `listings`, `properties` or `units`. `removeComplianceFixtures()` is the one exception, and only
 * for DELETE (see its own comment) — there is no exported "delete a listing" helper because nothing
 * in the product needs one yet, and this module only ever deletes rows carrying its own fixture
 * marker.
 *
 * All 11 required scenarios are reachable as of commit 6d041e7, which widened `upsertListing()` and
 * `insertOpenHouse()` to bind `description_moderation`, `featured_reason`, `internet_display_allowed`,
 * `address_display_allowed`, `remarks` and `is_cancelled` — previously none of those six columns were
 * caller-settable at all (they silently took the table default), which made the suppressed-address,
 * suppressed-listing, unapproved-description and cancelled-open-house scenarios impossible to build
 * without a second write path or raw SQL. See git history on this file for the prior "STOP and
 * report" state if you need the detail.
 *
 * Every listing fixture states `internet_display_allowed`, `address_display_allowed`,
 * `description_moderation` and `featured_reason` EXPLICITLY at its call site (see
 * `buildFixtureListingRow`, which takes them as required parameters with no default) — that is the
 * whole point of `ListingRow` making them required: a fixture that forgot one would silently publish
 * a suppressed row exactly like the bug this module exists to catch. No fixture row ever sets
 * `featured_reason` to `'paid'` — a later spec asserts that no row anywhere does, because the
 * Sponsored disclosure label cannot be rendered until #24.
 */

import { randomUUID } from 'node:crypto';

import {
  getOrCreateProperty,
  getOrCreateUnit,
  insertCommunity,
  insertOpenHouse,
  Queryable,
  upsertListing,
} from '../../src/db/write';
import { buildAddressKey } from '../../src/seed/address';
import { Amenity, ListingStatus, PropertyType } from '../../src/seed/constants';
import {
  CommunityRow,
  DescriptionModeration,
  FeaturedReason,
  ListingRow,
  OfferKind,
  PropertyRow,
  UnitRow,
} from '../../src/seed/types';

/** Ids of every fixture row, keyed by the scenario name a spec asserts against. */
export interface ComplianceFixtureIds {
  suppressedAddressListingId: string;
  /** The real unit number, so a spec can assert it is NOT emitted. */
  suppressedAddressUnitNumber: string;
  /** The real street line, so a spec can assert `street=` does NOT match it. */
  suppressedAddressStreetLine: string;
  /**
   * The real point, so a spec can assert NO column of the view carries it. Distinct from every
   * other fixture's 0/0 precisely so that assertion cannot pass vacuously.
   */
  suppressedAddressLatitude: number;
  suppressedAddressLongitude: number;
  suppressedListingId: string;
  unapprovedDescriptionListingId: string;
  /** So a spec can assert `query=` never matches it. */
  unapprovedDescriptionText: string;
  nonConsumerStatusListingIds: Record<'Withdrawn' | 'Expired' | 'Canceled' | 'Hold', string>;
  landParcelListingId: string;
  landParcelLotSqft: number;
  soldWithCloseDateListingId: string;
  soldWithoutCloseDateListingId: string;
  /** starts_at in the past, ends_at in the future. */
  inProgressOpenHouseListingId: string;
  /** ends_at in the past — must NOT match openHouse=true. */
  pastOpenHouseListingId: string;
  /** upcoming but is_cancelled — must NOT match. */
  cancelledOpenHouseListingId: string;
  sampleListingId: string;
}

/** The narrow seam this module needs, mirroring src/seed/seed.ts's SeedQueryable/SeedConnectable. */
interface FixturesQueryable extends Queryable {
  release: () => void;
}

interface FixturesPool {
  connect: () => Promise<FixturesQueryable>;
}

// --- Guard 2: opt-in -------------------------------------------------------------------------------

/**
 * Throws unless this module is deliberately enabled, and refuses production unconditionally.
 *
 * `loadComplianceFixtures()` and `removeComplianceFixtures()` both call this before doing anything
 * else, including before `pool.connect()` — a misconfigured environment must fail before it can touch
 * a socket, not after.
 */
export function assertFixturesEnabled(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'assertFixturesEnabled: refusing to run with NODE_ENV=production, even if ' +
        'PROPERTY_SERVICE_E2E_FIXTURES is set. These fixtures write self-labelled fake inventory ' +
        'directly to whatever database DATABASE_URL points at, and must never touch a production one.',
    );
  }
  if (process.env.PROPERTY_SERVICE_E2E_FIXTURES !== '1') {
    throw new Error(
      'assertFixturesEnabled: compliance fixtures are disabled. Set PROPERTY_SERVICE_E2E_FIXTURES=1 ' +
        'in the environment running the e2e suite before calling loadComplianceFixtures() or ' +
        'removeComplianceFixtures(). This guard exists because this module writes directly to the ' +
        'database and must never run against anything but a disposable e2e database.',
    );
  }
}

// --- Guard 3: self-labelling shape -----------------------------------------------------------------

const FIXTURE_TITLE_PREFIX = 'E2E Fixture';
const FIXTURE_COMMUNITY_NAME = 'E2E Fixture Compliance Community (Sample)';

// Obviously non-real: no such city/state/zip exists.
const FIXTURE_CITY = 'Fixtureville';
const FIXTURE_STATE = 'ZZ';
const FIXTURE_ZIP = '00000';
const FIXTURE_LATITUDE = 0;
const FIXTURE_LONGITUDE = 0;

/**
 * The suppressed-address fixture gets its OWN coordinates, distinct from the shared 0/0 above.
 *
 * `tests/listing-search-view.e2e.spec.ts` proves the coordinate half of the address opt-out by
 * scanning EVERY column of the view's row for the property's real point. At 0/0 that scan is
 * vacuous — "0" appears in half the columns of any listing row, so it would pass whether the view
 * masked the point or not, which is precisely the failure mode `fixture-ids.ts` exists to prevent.
 *
 * Repeated digits in the middle of the Pacific keep guard 3 (self-labelling shape) intact: still
 * unmistakably synthetic, and nowhere near the MD/DC/VA footprint, while being distinctive enough
 * that a substring scan over the whole row actually means something.
 */
const SUPPRESSED_ADDRESS_LATITUDE = 11.111111;
const SUPPRESSED_ADDRESS_LONGITUDE = -155.555555;

// Attribution to the real brokerage is compliance-CORRECT (NAR 7.58) — only the contact channels
// below are the RFC 2606 / reserved-range fakes, so a leaked row cannot be dialed or emailed.
const FIXTURE_BROKER_NAME = 'Real Broker, LLC';
const FIXTURE_BROKER_PHONE = '555-0100';
const FIXTURE_BROKER_EMAIL = 'e2e-fixture-broker@example.com';
const FIXTURE_OFFICE_NAME = 'Real Broker, LLC';
const FIXTURE_OFFICE_PHONE = '555-0101';
const FIXTURE_OFFICE_EMAIL = 'e2e-fixture-office@example.com';
const FIXTURE_AGENT_NAME = 'E2E Fixture Agent (Sample)';

/** One obviously-fake street per scenario, so two fixture rows never collide on address_key. */
const FIXTURE_STREETS = {
  suppressedAddress: '100 Fixture Test Lane',
  suppressedListing: '101 Fixture Test Lane',
  unapprovedDescription: '102 Fixture Test Lane',
  withdrawn: '103 Fixture Test Lane',
  expired: '104 Fixture Test Lane',
  canceled: '105 Fixture Test Lane',
  hold: '106 Fixture Test Lane',
  land: '107 Fixture Test Lane',
  soldWithCloseDate: '108 Fixture Test Lane',
  soldWithoutCloseDate: '109 Fixture Test Lane',
  openHouseInProgress: '110 Fixture Test Lane',
  pastOpenHouse: '111 Fixture Test Lane',
  cancelledOpenHouse: '112 Fixture Test Lane',
  sample: '113 Fixture Test Lane',
} as const;

function buildFixtureProperty(input: {
  id: string;
  communityId: string;
  streetLine: string;
  propertyType: PropertyType;
  beds: number | null;
  bathsFull: number | null;
  bathsHalf: number | null;
  livingSqft: number | null;
  lotSqft: number | null;
  /** Defaults to the shared 0/0; only the suppressed-address scenario needs its own point. */
  latitude?: number;
  longitude?: number;
}): PropertyRow {
  return {
    id: input.id,
    community_id: input.communityId,
    address_raw: input.streetLine,
    street_line: input.streetLine,
    city: FIXTURE_CITY,
    state: FIXTURE_STATE,
    zip5: FIXTURE_ZIP,
    address_key: buildAddressKey({
      streetLine: input.streetLine,
      state: FIXTURE_STATE,
      zip5: FIXTURE_ZIP,
    }),
    latitude: input.latitude ?? FIXTURE_LATITUDE,
    longitude: input.longitude ?? FIXTURE_LONGITUDE,
    neighborhood: null,
    property_type: input.propertyType,
    year_built: 1990,
    lot_sqft: input.lotSqft,
    beds: input.beds,
    baths_full: input.bathsFull,
    baths_half: input.bathsHalf,
    living_sqft: input.livingSqft,
    is_sample: true,
  };
}

/**
 * Builds a `listings` row for `upsertListing()`. The physical snapshot fields (beds/baths/sqft/
 * lot/year/neighborhood/city/state/zip/lat/long) are set to null/placeholder here deliberately —
 * `upsertListing()` IGNORES whatever the caller passes for them and resolves the real snapshot from
 * the property/unit rows instead (see src/db/write.ts's module header). Passing anything else here
 * would just be dead data.
 *
 * `internetDisplayAllowed`, `addressDisplayAllowed`, `descriptionModeration` and `featuredReason` are
 * required (no default) so every call site below states them explicitly, matching why `ListingRow`
 * itself makes them required rather than optional.
 */
function buildFixtureListingRow(input: {
  id: string;
  propertyId: string;
  unitId?: string | null;
  title: string;
  offerKind: OfferKind;
  consumerStatus: ListingStatus | null;
  status: string;
  listPrice: number;
  closePrice?: number | null;
  closeDate?: string | null;
  description: string;
  descriptionModeration: DescriptionModeration;
  featuredReason: FeaturedReason | null;
  internetDisplayAllowed: boolean;
  addressDisplayAllowed: boolean;
  amenities?: Amenity[];
}): ListingRow {
  return {
    id: input.id,
    property_id: input.propertyId,
    unit_id: input.unitId ?? null,
    title: `${FIXTURE_TITLE_PREFIX}: ${input.title} (Sample)`,
    offer_kind: input.offerKind,
    consumer_status: input.consumerStatus,
    status: input.status,
    source: 'internal',
    list_price: input.listPrice,
    close_price: input.closePrice ?? null,
    close_date: input.closeDate ?? null,
    beds: null,
    baths_full: null,
    baths_half: null,
    living_sqft: null,
    lot_sqft: null,
    year_built: null,
    neighborhood: null,
    city: FIXTURE_CITY,
    state: FIXTURE_STATE,
    zip5: FIXTURE_ZIP,
    latitude: FIXTURE_LATITUDE,
    longitude: FIXTURE_LONGITUDE,
    description: input.description,
    description_source: 'internal',
    description_moderation: input.descriptionModeration,
    amenities: input.amenities ?? [],
    featured: false,
    // Never 'paid': the Sponsored disclosure label can't render until #24, and a later spec asserts
    // no row anywhere carries it.
    featured_reason: input.featuredReason,
    price_reduced: false,
    new_construction: false,
    internet_display_allowed: input.internetDisplayAllowed,
    address_display_allowed: input.addressDisplayAllowed,
    broker_name: FIXTURE_BROKER_NAME,
    broker_phone: FIXTURE_BROKER_PHONE,
    broker_email: FIXTURE_BROKER_EMAIL,
    office_name: FIXTURE_OFFICE_NAME,
    office_broker_lead_phone: FIXTURE_OFFICE_PHONE,
    office_broker_lead_email: FIXTURE_OFFICE_EMAIL,
    listing_agent_name: FIXTURE_AGENT_NAME,
    is_sample: true,
    last_updated: new Date().toISOString(),
  };
}

function isoHoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

/**
 * Loads every required compliance fixture through `src/db/write.ts`, inside one transaction, and
 * returns their ids.
 *
 * Idempotent: `upsertListing()`, `insertCommunity()` and `insertOpenHouse()` are plain INSERTs with
 * no `ON CONFLICT`, so calling this twice would otherwise collide on a reused id. Calling
 * `removeComplianceFixtures()` first (before opening this function's own transaction) is what makes a
 * second call safe.
 */
export async function loadComplianceFixtures(pool: FixturesPool): Promise<ComplianceFixtureIds> {
  assertFixturesEnabled();
  await removeComplianceFixtures(pool);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const communityId = randomUUID();
    const communityRow: CommunityRow = {
      id: communityId,
      name: FIXTURE_COMMUNITY_NAME,
      is_sample: true,
    };
    await insertCommunity(client, communityRow);

    // --- Suppressed address: address_display_allowed=false, on a genuinely subdivided property so
    // the view's unit-number suppression is exercised too, not just the street mask -----------------
    const suppressedAddressPropertyId = randomUUID();
    await getOrCreateProperty(
      client,
      buildFixtureProperty({
        id: suppressedAddressPropertyId,
        communityId,
        streetLine: FIXTURE_STREETS.suppressedAddress,
        propertyType: 'Condo',
        beds: 2,
        bathsFull: 2,
        bathsHalf: 0,
        livingSqft: 1200,
        lotSqft: null,
        // Distinct from every other fixture's 0/0 so the whole-row coordinate scan in
        // listing-search-view.e2e.spec.ts is not vacuous. See the constants' own comment.
        latitude: SUPPRESSED_ADDRESS_LATITUDE,
        longitude: SUPPRESSED_ADDRESS_LONGITUDE,
      }),
    );
    // A LONG, DISTINCTIVE designator, not a bare `4B` — this value is used as a SUBSTRING NEEDLE by
    // four assertions across three spec files (listing-search-view's whole-row scan, and the
    // whole-payload scans in listings-search and listings-detail). A two-character needle scanned
    // across a whole row or a serialised payload collides with unrelated text and produces a false
    // PASS, which is the one failure mode this fixture module exists to prevent. `PH-1207` is a real
    // building's style of unit designator, so the row stays realistic, and it cannot collide.
    // Keep it above the length floor asserted in listing-search-view.e2e.spec.ts.
    const suppressedAddressUnitNumber = 'PH-1207';
    const suppressedAddressUnitId = await getOrCreateUnit(client, {
      id: randomUUID(),
      property_id: suppressedAddressPropertyId,
      unit_number: suppressedAddressUnitNumber,
      // Coupled to the designator above: `PH-1207` reads as penthouse level, floor 12. A fixture
      // whose unit number and floor disagree is a distraction for whoever debugs it next.
      floor: 12,
      beds: 2,
      baths_full: 2,
      baths_half: 0,
      living_sqft: 1200,
      is_sample: true,
    } satisfies UnitRow);
    const suppressedAddressListingId = randomUUID();
    await upsertListing(
      client,
      buildFixtureListingRow({
        id: suppressedAddressListingId,
        propertyId: suppressedAddressPropertyId,
        unitId: suppressedAddressUnitId,
        title: 'Suppressed Address',
        offerKind: 'sale',
        consumerStatus: 'Active',
        status: 'Active',
        listPrice: 350000,
        description:
          'This E2E Fixture (Sample) listing is a 2 bedroom, 2 bathroom condo unit of 1,200 square feet.',
        descriptionModeration: 'approved',
        featuredReason: null,
        internetDisplayAllowed: true,
        // The scenario under test: the seller opted out of address display, so the view must mask
        // street_line/unit_number/latitude/longitude together.
        addressDisplayAllowed: false,
      }),
    );

    // --- Suppressed listing: internet_display_allowed=false → absent everywhere, 404 on detail -----
    const suppressedListingPropertyId = randomUUID();
    await getOrCreateProperty(
      client,
      buildFixtureProperty({
        id: suppressedListingPropertyId,
        communityId,
        streetLine: FIXTURE_STREETS.suppressedListing,
        propertyType: 'Single Family',
        beds: 3,
        bathsFull: 2,
        bathsHalf: 0,
        livingSqft: 1800,
        lotSqft: 6000,
      }),
    );
    const suppressedListingId = randomUUID();
    await upsertListing(
      client,
      buildFixtureListingRow({
        id: suppressedListingId,
        propertyId: suppressedListingPropertyId,
        title: 'Suppressed Listing',
        offerKind: 'sale',
        consumerStatus: 'Active',
        status: 'Active',
        listPrice: 425000,
        description:
          'This E2E Fixture (Sample) listing has a 3 bedroom, 2 bathroom single family home.',
        descriptionModeration: 'approved',
        featuredReason: null,
        // The scenario under test: the seller withheld the WHOLE listing.
        internetDisplayAllowed: false,
        addressDisplayAllowed: true,
      }),
    );

    // --- Unapproved description: description_moderation='suppressed' → withheld, never matched -----
    const unapprovedDescriptionText =
      'E2E FIXTURE UNAPPROVED DESCRIPTION (Sample): this third-party remark text has not passed ' +
      'moderation and must never be returned to a consumer or matched by free-text search.';
    const unapprovedDescriptionPropertyId = randomUUID();
    await getOrCreateProperty(
      client,
      buildFixtureProperty({
        id: unapprovedDescriptionPropertyId,
        communityId,
        streetLine: FIXTURE_STREETS.unapprovedDescription,
        propertyType: 'Single Family',
        beds: 3,
        bathsFull: 2,
        bathsHalf: 0,
        livingSqft: 1800,
        lotSqft: 6000,
      }),
    );
    const unapprovedDescriptionListingId = randomUUID();
    await upsertListing(
      client,
      buildFixtureListingRow({
        id: unapprovedDescriptionListingId,
        propertyId: unapprovedDescriptionPropertyId,
        title: 'Unapproved Description',
        offerKind: 'sale',
        consumerStatus: 'Active',
        status: 'Active',
        listPrice: 435000,
        description: unapprovedDescriptionText,
        // The scenario under test: pending moderation withholds the description from the view.
        descriptionModeration: 'suppressed',
        featuredReason: null,
        internetDisplayAllowed: true,
        addressDisplayAllowed: true,
      }),
    );

    // --- Land parcel: NULL beds/baths/sqft, non-null lot_sqft --------------------------------------
    // upsertListing() resolves the snapshot from the PROPERTY, not from whatever is passed on the
    // listing row, so the NULLs have to live on the property itself.
    const landPropertyId = randomUUID();
    await getOrCreateProperty(
      client,
      buildFixtureProperty({
        id: landPropertyId,
        communityId,
        streetLine: FIXTURE_STREETS.land,
        propertyType: 'Land',
        beds: null,
        bathsFull: null,
        bathsHalf: null,
        livingSqft: null,
        lotSqft: 43560,
      }),
    );
    const landParcelLotSqft = 43560;
    const landParcelListingId = randomUUID();
    await upsertListing(
      client,
      buildFixtureListingRow({
        id: landParcelListingId,
        propertyId: landPropertyId,
        title: 'Land Parcel',
        offerKind: 'sale',
        consumerStatus: 'Active',
        status: 'Active',
        listPrice: 250000,
        description:
          'This E2E Fixture (Sample) listing is an unimproved land parcel of 43,560 square feet ' +
          '(1 acre). No dwelling exists on this parcel.',
        descriptionModeration: 'approved',
        featuredReason: null,
        internetDisplayAllowed: true,
        addressDisplayAllowed: true,
      }),
    );

    // --- Sold WITH a close date: publishable, close_price differs from list_price ------------------
    const soldWithCloseDatePropertyId = randomUUID();
    await getOrCreateProperty(
      client,
      buildFixtureProperty({
        id: soldWithCloseDatePropertyId,
        communityId,
        streetLine: FIXTURE_STREETS.soldWithCloseDate,
        propertyType: 'Single Family',
        beds: 3,
        bathsFull: 2,
        bathsHalf: 0,
        livingSqft: 1800,
        lotSqft: 6000,
      }),
    );
    const soldWithCloseDateListingId = randomUUID();
    await upsertListing(
      client,
      buildFixtureListingRow({
        id: soldWithCloseDateListingId,
        propertyId: soldWithCloseDatePropertyId,
        title: 'Sold With Close Date',
        offerKind: 'sale',
        consumerStatus: 'Sold',
        status: 'Closed',
        listPrice: 500000,
        closePrice: 480000,
        closeDate: '2026-01-05',
        description:
          'This E2E Fixture (Sample) listing recorded a closed sale with a list price of $500,000 ' +
          'and a close price of $480,000.',
        descriptionModeration: 'approved',
        featuredReason: null,
        internetDisplayAllowed: true,
        addressDisplayAllowed: true,
      }),
    );

    // --- Sold WITHOUT a close date: never publishable ------------------------------------------------
    // close_price stays NULL too: the table's CHECK requires close_price IS NULL OR
    // close_date IS NOT NULL, so a close price with no close date is not representable (correctly).
    const soldWithoutCloseDatePropertyId = randomUUID();
    await getOrCreateProperty(
      client,
      buildFixtureProperty({
        id: soldWithoutCloseDatePropertyId,
        communityId,
        streetLine: FIXTURE_STREETS.soldWithoutCloseDate,
        propertyType: 'Single Family',
        beds: 3,
        bathsFull: 2,
        bathsHalf: 0,
        livingSqft: 1800,
        lotSqft: 6000,
      }),
    );
    const soldWithoutCloseDateListingId = randomUUID();
    await upsertListing(
      client,
      buildFixtureListingRow({
        id: soldWithoutCloseDateListingId,
        propertyId: soldWithoutCloseDatePropertyId,
        title: 'Sold Without Close Date',
        offerKind: 'sale',
        consumerStatus: 'Sold',
        status: 'Closed',
        listPrice: 500000,
        description:
          'This E2E Fixture (Sample) listing recorded a closed sale with no close date on file.',
        descriptionModeration: 'approved',
        featuredReason: null,
        internetDisplayAllowed: true,
        addressDisplayAllowed: true,
      }),
    );

    // --- Non-consumer statuses: excluded by listing_search_v's `consumer_status IS NOT NULL` -------
    // listing_statuses.consumer_status is NULL for every one of these feed codes, and
    // upsertListing() binds whatever this function passes directly to the column — it does not look
    // the value up from listing_statuses itself. So the caller must supply NULL explicitly.
    const nonConsumerStreets: Record<'Withdrawn' | 'Expired' | 'Canceled' | 'Hold', string> = {
      Withdrawn: FIXTURE_STREETS.withdrawn,
      Expired: FIXTURE_STREETS.expired,
      Canceled: FIXTURE_STREETS.canceled,
      Hold: FIXTURE_STREETS.hold,
    };
    const nonConsumerStatusListingIds = {} as Record<
      'Withdrawn' | 'Expired' | 'Canceled' | 'Hold',
      string
    >;
    for (const status of ['Withdrawn', 'Expired', 'Canceled', 'Hold'] as const) {
      const propertyId = randomUUID();
      await getOrCreateProperty(
        client,
        buildFixtureProperty({
          id: propertyId,
          communityId,
          streetLine: nonConsumerStreets[status],
          propertyType: 'Single Family',
          beds: 3,
          bathsFull: 2,
          bathsHalf: 0,
          livingSqft: 1800,
          lotSqft: 6000,
        }),
      );
      const listingId = randomUUID();
      await upsertListing(
        client,
        buildFixtureListingRow({
          id: listingId,
          propertyId,
          title: `${status} Listing`,
          offerKind: 'sale',
          consumerStatus: null,
          status,
          listPrice: 400000,
          description:
            `This E2E Fixture (Sample) listing exercises the ${status} feed status, which the ` +
            'Property API must never surface to a consumer.',
          descriptionModeration: 'approved',
          featuredReason: null,
          internetDisplayAllowed: true,
          addressDisplayAllowed: true,
        }),
      );
      nonConsumerStatusListingIds[status] = listingId;
    }

    // --- Open house in progress: starts_at past, ends_at future, not cancelled ---------------------
    // Also the fixture carrying a non-null `remarks`, so openHouse.remarks is exercised on the wire.
    const inProgressPropertyId = randomUUID();
    await getOrCreateProperty(
      client,
      buildFixtureProperty({
        id: inProgressPropertyId,
        communityId,
        streetLine: FIXTURE_STREETS.openHouseInProgress,
        propertyType: 'Single Family',
        beds: 3,
        bathsFull: 2,
        bathsHalf: 0,
        livingSqft: 1800,
        lotSqft: 6000,
      }),
    );
    const inProgressOpenHouseListingId = randomUUID();
    await upsertListing(
      client,
      buildFixtureListingRow({
        id: inProgressOpenHouseListingId,
        propertyId: inProgressPropertyId,
        title: 'Open House In Progress',
        offerKind: 'sale',
        consumerStatus: 'Active',
        status: 'Active',
        listPrice: 450000,
        description: 'This E2E Fixture (Sample) listing has an open house currently in progress.',
        descriptionModeration: 'approved',
        featuredReason: null,
        internetDisplayAllowed: true,
        addressDisplayAllowed: true,
      }),
    );
    await insertOpenHouse(client, {
      id: randomUUID(),
      listing_id: inProgressOpenHouseListingId,
      starts_at: isoHoursFromNow(-1),
      ends_at: isoHoursFromNow(1),
      remarks: 'E2E Fixture (Sample) remarks: enter through the side door; parking is on-street.',
      is_cancelled: false,
      is_sample: true,
    });

    // --- Open house past only: ends_at already elapsed ---------------------------------------------
    const pastOpenHousePropertyId = randomUUID();
    await getOrCreateProperty(
      client,
      buildFixtureProperty({
        id: pastOpenHousePropertyId,
        communityId,
        streetLine: FIXTURE_STREETS.pastOpenHouse,
        propertyType: 'Single Family',
        beds: 3,
        bathsFull: 2,
        bathsHalf: 0,
        livingSqft: 1800,
        lotSqft: 6000,
      }),
    );
    const pastOpenHouseListingId = randomUUID();
    await upsertListing(
      client,
      buildFixtureListingRow({
        id: pastOpenHouseListingId,
        propertyId: pastOpenHousePropertyId,
        title: 'Past Open House',
        offerKind: 'sale',
        consumerStatus: 'Active',
        status: 'Active',
        listPrice: 450000,
        description: 'This E2E Fixture (Sample) listing has an open house that already ended.',
        descriptionModeration: 'approved',
        featuredReason: null,
        internetDisplayAllowed: true,
        addressDisplayAllowed: true,
      }),
    );
    await insertOpenHouse(client, {
      id: randomUUID(),
      listing_id: pastOpenHouseListingId,
      starts_at: isoHoursFromNow(-48),
      ends_at: isoHoursFromNow(-24),
      remarks: null,
      is_cancelled: false,
      is_sample: true,
    });

    // --- Open house cancelled: upcoming times, but is_cancelled=true — must NOT match --------------
    // starts_at/ends_at are both in the future here, deliberately: the ONLY reason this must not
    // match `openHouse=true` is the cancellation flag, not stale timing (that is pastOpenHouse's job).
    const cancelledOpenHousePropertyId = randomUUID();
    await getOrCreateProperty(
      client,
      buildFixtureProperty({
        id: cancelledOpenHousePropertyId,
        communityId,
        streetLine: FIXTURE_STREETS.cancelledOpenHouse,
        propertyType: 'Single Family',
        beds: 3,
        bathsFull: 2,
        bathsHalf: 0,
        livingSqft: 1800,
        lotSqft: 6000,
      }),
    );
    const cancelledOpenHouseListingId = randomUUID();
    await upsertListing(
      client,
      buildFixtureListingRow({
        id: cancelledOpenHouseListingId,
        propertyId: cancelledOpenHousePropertyId,
        title: 'Cancelled Open House',
        offerKind: 'sale',
        consumerStatus: 'Active',
        status: 'Active',
        listPrice: 450000,
        description:
          'This E2E Fixture (Sample) listing has an upcoming open house that was cancelled.',
        descriptionModeration: 'approved',
        featuredReason: null,
        internetDisplayAllowed: true,
        addressDisplayAllowed: true,
      }),
    );
    await insertOpenHouse(client, {
      id: randomUUID(),
      listing_id: cancelledOpenHouseListingId,
      starts_at: isoHoursFromNow(24),
      ends_at: isoHoursFromNow(26),
      remarks: null,
      is_cancelled: true,
      is_sample: true,
    });

    // --- Sample row: is_sample=true (true of every row above too, but this one is addressed
    // directly by id, with no other scenario attached to it) ----------------------------------------
    const samplePropertyId = randomUUID();
    await getOrCreateProperty(
      client,
      buildFixtureProperty({
        id: samplePropertyId,
        communityId,
        streetLine: FIXTURE_STREETS.sample,
        propertyType: 'Single Family',
        beds: 3,
        bathsFull: 2,
        bathsHalf: 0,
        livingSqft: 1800,
        lotSqft: 6000,
      }),
    );
    const sampleListingId = randomUUID();
    await upsertListing(
      client,
      buildFixtureListingRow({
        id: sampleListingId,
        propertyId: samplePropertyId,
        title: 'Plain Sample Row',
        offerKind: 'sale',
        consumerStatus: 'Active',
        status: 'Active',
        listPrice: 425000,
        description:
          'This E2E Fixture (Sample) listing is a plain, otherwise unremarkable, active listing.',
        descriptionModeration: 'approved',
        featuredReason: null,
        internetDisplayAllowed: true,
        addressDisplayAllowed: true,
      }),
    );

    await client.query('COMMIT');

    return {
      suppressedAddressListingId,
      suppressedAddressUnitNumber,
      suppressedAddressStreetLine: FIXTURE_STREETS.suppressedAddress,
      suppressedAddressLatitude: SUPPRESSED_ADDRESS_LATITUDE,
      suppressedAddressLongitude: SUPPRESSED_ADDRESS_LONGITUDE,
      suppressedListingId,
      unapprovedDescriptionListingId,
      unapprovedDescriptionText,
      nonConsumerStatusListingIds,
      landParcelListingId,
      landParcelLotSqft,
      soldWithCloseDateListingId,
      soldWithoutCloseDateListingId,
      inProgressOpenHouseListingId,
      pastOpenHouseListingId,
      cancelledOpenHouseListingId,
      sampleListingId,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Removes every fixture row this module created, matched by the fixture community marker — never a
 * blanket `DELETE FROM listings`/`properties`/`units`.
 *
 * This is the one place in this module that issues raw SQL against those tables, and it is DELETE
 * only, never INSERT/UPDATE (the restriction `src/seed/seed.spec.ts` enforces is specifically about
 * writers that create/mutate rows in `listings`; there is no exported "delete a listing" helper on
 * `src/db/write.ts` because nothing in the product needs one yet). Deletion order follows the FKs
 * those tables declare: `listing_events` RESTRICTs against both `listings` and `properties`, so it
 * must go first; `listing_open_houses`/`listing_media` CASCADE from `listings` and need no separate
 * statement; `units` RESTRICTs against `listings` (and vice versa), so `listings` goes before
 * `units`; `properties.community_id` is `SET NULL` on community delete rather than cascading, so
 * `properties` needs an explicit delete too.
 *
 * No-ops (does not throw) when no fixture community exists — safe to call even if nothing was ever
 * loaded, which is what makes `loadComplianceFixtures()` safe to call more than once.
 */
export async function removeComplianceFixtures(pool: FixturesPool): Promise<void> {
  assertFixturesEnabled();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query('SELECT id FROM communities WHERE name = $1', [
      FIXTURE_COMMUNITY_NAME,
    ]);
    const communityId = rows[0]?.id;

    if (typeof communityId === 'string') {
      await client.query(
        'DELETE FROM listing_events WHERE property_id IN ' +
          '(SELECT id FROM properties WHERE community_id = $1)',
        [communityId],
      );
      await client.query(
        'DELETE FROM listings WHERE property_id IN ' +
          '(SELECT id FROM properties WHERE community_id = $1)',
        [communityId],
      );
      await client.query(
        'DELETE FROM units WHERE property_id IN ' +
          '(SELECT id FROM properties WHERE community_id = $1)',
        [communityId],
      );
      await client.query('DELETE FROM properties WHERE community_id = $1', [communityId]);
      await client.query('DELETE FROM communities WHERE id = $1', [communityId]);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
