import { randomUUID } from 'crypto';
import { closePool, getPool } from '../db/pool';
import { mockListings } from './mock-listings';
import {
  groupListingsByCommunity,
  mapToCommunityRow,
  mapToListingRow,
  mapToPropertyRow,
  mapToUnitRow,
} from './transform';
import { CommunityRow, ListingRow, PropertyRow, UnitRow } from './types';

/**
 * Minimal shape `runSeed` needs from a pg client — deliberately narrower than
 * `pg.PoolClient` so unit tests can pass a lightweight fake instead of a real
 * connection. A real `pg.Pool`/`PoolClient` satisfies this structurally.
 */
interface SeedQueryable {
  query: (text: string, values?: unknown[]) => Promise<unknown>;
  release: () => void;
}

interface SeedConnectable {
  connect: () => Promise<SeedQueryable>;
}

/**
 * Seeds `property_db` from the adapted mock dataset (`mock-listings.ts`).
 * Every listing's `source` is forced to `'internal'` by `transform.ts` —
 * seed/dev data must never be represented as MLS-sourced (PRD §6.2/§6.3).
 *
 * Groups listings into synthetic communities (by neighborhood/city/state) so
 * every property/listing has a non-orphaned parent hierarchy
 * (communities -> properties -> [units] -> listings, per PRD §3).
 *
 * Accepts anything exposing `.connect()` returning a `query`/`release` pair
 * (a real `pg.Pool`, or a lightweight fake) so it can be exercised in unit
 * tests without a live database.
 */
export async function runSeed(pool: SeedConnectable): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const groups = groupListingsByCommunity(mockListings);

    for (const [, listingsInCommunity] of groups) {
      const firstListing = listingsInCommunity[0];
      if (!firstListing) {
        // Unreachable: groupListingsByCommunity never creates an empty group.
        continue;
      }
      const communityRow: CommunityRow = mapToCommunityRow(randomUUID(), firstListing);
      await client.query('INSERT INTO communities (id, name) VALUES ($1, $2)', [
        communityRow.id,
        communityRow.name,
      ]);

      for (const listing of listingsInCommunity) {
        const propertyRow: PropertyRow = mapToPropertyRow(randomUUID(), communityRow.id, listing);
        await client.query(
          `INSERT INTO properties
             (id, community_id, address, city, state, zip, latitude, longitude, property_type, year_built)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            propertyRow.id,
            propertyRow.community_id,
            propertyRow.address,
            propertyRow.city,
            propertyRow.state,
            propertyRow.zip,
            propertyRow.latitude,
            propertyRow.longitude,
            propertyRow.property_type,
            propertyRow.year_built,
          ],
        );

        const unitRow: UnitRow | null = mapToUnitRow(randomUUID(), propertyRow.id, listing);
        if (unitRow) {
          await client.query(
            `INSERT INTO units (id, property_id, unit_number, floor, sqft)
             VALUES ($1, $2, $3, $4, $5)`,
            [unitRow.id, unitRow.property_id, unitRow.unit_number, unitRow.floor, unitRow.sqft],
          );
        }

        const listingRow: ListingRow = mapToListingRow(
          randomUUID(),
          propertyRow.id,
          unitRow ? unitRow.id : null,
          listing,
        );
        await client.query(
          `INSERT INTO listings
             (id, property_id, unit_id, title, listing_type, source, status, price, beds, baths,
              sqft, lot_sqft, year_built, neighborhood, city, state, zip, latitude, longitude,
              image_urls, description, amenities, featured, price_reduced, new_construction,
              open_house_date, open_house_start_time, open_house_end_time,
              broker_name, broker_phone, broker_email, office_name,
              office_broker_lead_phone, office_broker_lead_email, is_sample, last_updated)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                   $11, $12, $13, $14, $15, $16, $17, $18, $19,
                   $20, $21, $22, $23, $24, $25,
                   $26, $27, $28,
                   $29, $30, $31, $32,
                   $33, $34, $35, $36)`,
          [
            listingRow.id,
            listingRow.property_id,
            listingRow.unit_id,
            listingRow.title,
            listingRow.listing_type,
            listingRow.source,
            listingRow.status,
            listingRow.price,
            listingRow.beds,
            listingRow.baths,
            listingRow.sqft,
            listingRow.lot_sqft,
            listingRow.year_built,
            listingRow.neighborhood,
            listingRow.city,
            listingRow.state,
            listingRow.zip,
            listingRow.latitude,
            listingRow.longitude,
            listingRow.image_urls,
            listingRow.description,
            listingRow.amenities,
            listingRow.featured,
            listingRow.price_reduced,
            listingRow.new_construction,
            listingRow.open_house_date,
            listingRow.open_house_start_time,
            listingRow.open_house_end_time,
            listingRow.broker_name,
            listingRow.broker_phone,
            listingRow.broker_email,
            listingRow.office_name,
            listingRow.office_broker_lead_phone,
            listingRow.office_broker_lead_email,
            listingRow.is_sample,
            listingRow.last_updated,
          ],
        );
      }
    }

    await client.query('COMMIT');
    console.info(
      `Seeded ${groups.size} communit${groups.size === 1 ? 'y' : 'ies'} and ${mockListings.length} listing(s) (source=internal).`,
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/* istanbul ignore next -- exercised manually against a live DB, not under unit test */
async function main(): Promise<void> {
  const pool = getPool();
  try {
    await runSeed(pool);
  } finally {
    await closePool();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  });
}
