/**
 * #716. Fixtures for the one-card-per-home e2e. Each home is a property with one or more live MLS
 * records. Every row goes through `src/db/write.ts` and carries the self-labelling shape of
 * `fixtures.ts`: sample, `E2E Fixture` title, example.com mailboxes, a city that does not exist.
 *
 * `setRecordFacts` and `takeDown` are the only raw UPDATEs. `upsertListing()` copies beds, baths and area from the
 * property, so two records of one property always agree. A real record can differ when the property
 * changed between two writes. The UPDATE reproduces that case.
 */

import { randomUUID } from 'node:crypto';

import { buildAddressKey } from '../../src/db/address';
import type { ListingStatus, PropertyType } from '../../src/db/constants';
import type { ListingRow } from '../../src/db/types';
import {
  getOrCreateProperty,
  getOrCreateUnit,
  insertCommunity,
  type Queryable,
  upsertListing,
} from '../../src/db/write';
import { assertFixturesEnabled } from './fixtures';

export const COLLAPSE_CITY = 'Collapseville';
export const COLLAPSE_STATE = 'ZZ';
const COLLAPSE_ZIP = '00001';
const COMMUNITY_NAME = 'E2E Fixture Collapse Community (Sample)';

export interface CollapsePool {
  connect: () => Promise<Queryable & { release: () => void }>;
}

export interface RecordInput {
  /** Fixed ids make the last tie-break (the greater id) testable. */
  id?: string;
  status?: ListingStatus | null;
  listPrice?: number;
  listedAt?: string | null;
  modifiedAt?: string | null;
  office?: string;
  /** Bright `ListOfficeKey`. Omitted means no key. */
  officeKey?: string | null;
  offerKind?: 'sale' | 'rent';
  daysOnMarket?: number | null;
  mlsNumber?: string | null;
  broker?: string;
  addressHidden?: boolean;
}

export interface HomeInput {
  street: string;
  propertyType?: PropertyType;
  /** Unit numbers. A record names its unit by index. */
  units?: string[];
  records: (RecordInput & { unit?: number })[];
  /** Defaults to `COLLAPSE_ZIP`. */
  zip?: string;
}

export interface SeededHome {
  propertyId: string;
  ids: string[];
}

function row(
  propertyId: string,
  unitId: string | null,
  input: RecordInput,
  index: number,
  street: string,
  zip: string,
): ListingRow {
  const status = input.status === undefined ? 'Active' : input.status;
  const office = input.office ?? 'E2E Fixture Office A';
  return {
    id: input.id ?? randomUUID(),
    property_id: propertyId,
    unit_id: unitId,
    title: `E2E Fixture ${street} #${index} (Sample)`,
    offer_kind: input.offerKind ?? 'sale',
    consumer_status: status,
    status: status ?? 'Withdrawn',
    source: 'internal',
    source_system: 'e2e-fixture',
    source_listing_key: randomUUID(),
    source_listing_id: input.mlsNumber === undefined ? `E2E${index}` : input.mlsNumber,
    source_modification_timestamp: input.modifiedAt ?? null,
    list_price: input.listPrice ?? 500000,
    close_price: null,
    close_date: null,
    beds: null,
    baths_full: null,
    baths_half: null,
    living_sqft: null,
    lot_sqft: null,
    year_built: null,
    neighborhood: 'Collapse Heights',
    city: COLLAPSE_CITY,
    state: COLLAPSE_STATE,
    zip5: zip,
    latitude: 20.5,
    longitude: 20.5,
    description: null,
    description_source: null,
    description_moderation: 'approved',
    amenities: [],
    featured: false,
    featured_reason: null,
    new_construction: false,
    internet_display_allowed: true,
    address_display_allowed: !input.addressHidden,
    price_display_allowed: true,
    price_history_display_allowed: true,
    media_display_allowed: true,
    days_on_market_display_allowed: true,
    days_on_market: input.daysOnMarket ?? null,
    broker_name: input.broker ?? 'Real Broker, LLC',
    broker_phone: '555-0100',
    broker_email: 'e2e-fixture-broker@example.com',
    office_name: office,
    office_key: input.officeKey ?? null,
    office_broker_lead_phone: null,
    office_broker_lead_email: null,
    listing_agent_name: 'E2E Fixture Agent',
    is_sample: true,
    last_updated: new Date().toISOString(),
    listed_at: input.listedAt === undefined ? '2026-09-18T00:00:00.000Z' : input.listedAt,
    coming_soon_date: null,
    status_changed_at: null,
  };
}

export async function seedHomes(
  pool: CollapsePool,
  homes: HomeInput[],
): Promise<Record<string, SeededHome>> {
  assertFixturesEnabled();
  await removeCollapseFixtures(pool);
  const client = await pool.connect();
  const seeded: Record<string, SeededHome> = {};
  try {
    await client.query('BEGIN');
    const communityId = randomUUID();
    await insertCommunity(client, { id: communityId, name: COMMUNITY_NAME, is_sample: true });
    for (const home of homes) {
      const propertyId = randomUUID();
      await getOrCreateProperty(client, {
        id: propertyId,
        community_id: communityId,
        address_raw: home.street,
        street_line: home.street,
        city: COLLAPSE_CITY,
        state: COLLAPSE_STATE,
        zip5: home.zip ?? COLLAPSE_ZIP,
        address_key: buildAddressKey({
          streetLine: home.street,
          state: COLLAPSE_STATE,
          zip5: home.zip ?? COLLAPSE_ZIP,
        }),
        latitude: 20.5,
        longitude: 20.5,
        neighborhood: 'Collapse Heights',
        property_type: home.propertyType ?? 'Single Family',
        year_built: 1990,
        lot_sqft: null,
        beds: 3,
        baths_full: 2,
        baths_half: 0,
        living_sqft: 1800,
        is_sample: true,
      });
      const unitIds: string[] = [];
      for (const unitNumber of home.units ?? []) {
        unitIds.push(
          await getOrCreateUnit(client, {
            id: randomUUID(),
            property_id: propertyId,
            unit_number: unitNumber,
            floor: null,
            beds: 3,
            baths_full: 2,
            baths_half: 0,
            living_sqft: 1800,
            is_sample: true,
          }),
        );
      }
      const ids: string[] = [];
      for (const [index, record] of home.records.entries()) {
        const unitId = record.unit === undefined ? null : (unitIds[record.unit] ?? null);
        ids.push(
          await upsertListing(
            client,
            row(propertyId, unitId, record, index, home.street, home.zip ?? COLLAPSE_ZIP),
          ),
        );
      }
      seeded[home.street] = { propertyId, ids };
    }
    await client.query('COMMIT');
    return seeded;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Test-only. Makes one record disagree with its sibling on beds or living area. */
export async function setRecordFacts(
  pool: CollapsePool,
  id: string,
  facts: { beds?: number; livingSqft?: number },
): Promise<void> {
  assertFixturesEnabled();
  const client = await pool.connect();
  try {
    await client.query(
      'UPDATE listings SET beds = COALESCE($2, beds), living_sqft = COALESCE($3, living_sqft) WHERE id = $1',
      [id, facts.beds ?? null, facts.livingSqft ?? null],
    );
  } finally {
    client.release();
  }
}

/** Test-only. Moves a record off-market, as the sync does when the feed withdraws it. */
export async function takeDown(pool: CollapsePool, id: string): Promise<void> {
  assertFixturesEnabled();
  const client = await pool.connect();
  try {
    await client.query(
      "UPDATE listings SET consumer_status = NULL, status = 'Withdrawn' WHERE id = $1",
      [id],
    );
  } finally {
    client.release();
  }
}

export async function removeCollapseFixtures(pool: CollapsePool): Promise<void> {
  assertFixturesEnabled();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT id FROM communities WHERE name = $1', [
      COMMUNITY_NAME,
    ]);
    const communityId = rows[0]?.id;
    if (typeof communityId === 'string') {
      const owned = '(SELECT id FROM properties WHERE community_id = $1)';
      await client.query(`DELETE FROM listing_events WHERE property_id IN ${owned}`, [communityId]);
      await client.query(`DELETE FROM listings WHERE property_id IN ${owned}`, [communityId]);
      await client.query(`DELETE FROM units WHERE property_id IN ${owned}`, [communityId]);
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
