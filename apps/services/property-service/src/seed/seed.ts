import { randomUUID } from 'crypto';
import { closePool, getPool } from '../db/pool';
import { recordAppliedHash } from '../db/seed-state';
import {
  deleteSampleData,
  getOrCreateProperty,
  getOrCreateUnit,
  insertCommunity,
  insertMedia,
  insertOpenHouse,
  Queryable,
  upsertListing,
} from '../db/write';
import { mockListings } from './mock-listings';
import {
  groupListingsByCommunity,
  mapToCommunityRow,
  mapToListingRow,
  mapToMediaRows,
  mapToOpenHouseRow,
  mapToPropertyRow,
  mapToUnitRow,
} from './transform';

/**
 * Minimal shape `runSeed` needs from a pg client — deliberately narrower than
 * `pg.PoolClient` so unit tests can pass a lightweight fake instead of a real
 * connection. A real `pg.Pool`/`PoolClient` satisfies this structurally.
 */
export interface SeedQueryable extends Queryable {
  release: () => void;
}

export interface SeedConnectable {
  connect: () => Promise<SeedQueryable>;
}

/**
 * Seeds `property_db` from the adapted mock dataset (`mock-listings.ts`).
 *
 * Every listing's `source` is forced to `'internal'` and `is_sample` to true by `transform.ts` —
 * seed/dev data must never be represented as MLS-sourced (PRD §6.2/§6.3).
 *
 * Two structural points, both different from the previous version:
 *
 * 1. Properties are resolved by their deduplication key, not blindly inserted. Two listings at the same
 *    street line therefore share ONE property row, which is what makes "a property may have zero or many
 *    listings over the years" real rather than aspirational.
 * 2. Listings are written only through `upsertListing()`, which resolves the dwelling snapshot from the
 *    durable property/unit rows. This module never issues INSERT/UPDATE on `listings` itself.
 *
 * Accepts anything exposing `.connect()` returning a `query`/`release` pair (a real `pg.Pool`, or a
 * lightweight fake) so it can be exercised in unit tests without a live database.
 */
/**
 * Arbitrary but fixed key identifying "the property_db sample seed" to `pg_advisory_xact_lock`.
 * Advisory locks share one namespace per database, so this value must not collide with another
 * subsystem's; nothing else in this service takes an advisory lock today.
 */
const SEED_ADVISORY_LOCK_KEY = 811_000_111;

export interface RunSeedOptions {
  /**
   * Remove every existing `is_sample` row before inserting, inside the same transaction. Required
   * when re-applying a changed dataset: upsert alone cannot express a listing that was DELETED from
   * `mock-listings.ts`, and the seed mints a fresh uuid per row, so an insert-only second pass
   * silently duplicates the whole dataset instead of updating it.
   */
  replaceExistingSampleData?: boolean;
  /**
   * The dataset hash to record in `seed_state` on success. Written inside this transaction, so a
   * rolled-back seed never leaves behind a claim that it applied.
   */
  datasetHash?: string;
}

export async function runSeed(
  pool: SeedConnectable,
  { replaceExistingSampleData = false, datasetHash }: RunSeedOptions = {},
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Serialises concurrent seeds against one database. Placing the trigger in an initContainer
    // removes the race between an app's REPLICAS, but not the one across a ROLLOUT: a rolling update
    // starts the new pod's migrate initContainer while the old pod is still up, and a retried deploy
    // can overlap likewise. Two seeds both observing a hash mismatch would both delete-then-insert.
    // A transaction-scoped advisory lock is released automatically on COMMIT or ROLLBACK, so it
    // cannot outlive a crashed seeder the way a session lock could.
    await client.query('SELECT pg_advisory_xact_lock($1)', [SEED_ADVISORY_LOCK_KEY]);

    if (replaceExistingSampleData) {
      await deleteSampleData(client);
    }

    const groups = groupListingsByCommunity(mockListings);
    // Address key -> property id, so the second listing on an address reuses the first's property even
    // within a single run.
    const propertyIdsByAddressKey = new Map<string, string>();

    for (const [, listingsInCommunity] of groups) {
      const firstListing = listingsInCommunity[0];
      if (!firstListing) {
        // Unreachable: groupListingsByCommunity never creates an empty group.
        continue;
      }
      const communityRow = mapToCommunityRow(randomUUID(), firstListing);
      await insertCommunity(client, communityRow);

      for (const listing of listingsInCommunity) {
        const propertyRow = mapToPropertyRow(randomUUID(), communityRow.id, listing);
        const knownPropertyId = propertyIdsByAddressKey.get(propertyRow.address_key);
        const propertyId = knownPropertyId ?? (await getOrCreateProperty(client, propertyRow));
        propertyIdsByAddressKey.set(propertyRow.address_key, propertyId);

        // Units stay optional (PRD §3): null here means the offer is on the whole property, and the
        // dwelling facts live on the property row instead.
        const unitRow = mapToUnitRow(randomUUID(), propertyId, listing);
        const unitId = unitRow ? await getOrCreateUnit(client, unitRow) : null;

        const listingRow = mapToListingRow(randomUUID(), propertyId, unitId, listing);
        await upsertListing(client, listingRow);

        const openHouseRow = mapToOpenHouseRow(randomUUID(), listingRow.id, listing);
        if (openHouseRow) {
          await insertOpenHouse(client, openHouseRow);
        }

        await insertMedia(
          client,
          mapToMediaRows(
            listing.imageUrls.map(() => randomUUID()),
            listingRow.id,
            listing,
          ),
        );
      }
    }

    if (datasetHash) {
      await recordAppliedHash(client, datasetHash);
    }

    await client.query('COMMIT');
    console.info(
      `${replaceExistingSampleData ? 'Re-seeded' : 'Seeded'} ` +
        `${groups.size} communit${groups.size === 1 ? 'y' : 'ies'}, ` +
        `${propertyIdsByAddressKey.size} propert${propertyIdsByAddressKey.size === 1 ? 'y' : 'ies'} ` +
        `and ${mockListings.length} listing(s) (source=internal, is_sample=true).`,
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
