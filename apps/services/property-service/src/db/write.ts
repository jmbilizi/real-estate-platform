import { randomUUID } from 'node:crypto';

import { ListingRow, MediaRow, OpenHouseRow, PropertyRow, UnitRow } from '../seed/types';
import { CommunityRow } from '../seed/types';

/**
 * THE ONLY MODULE THAT WRITES `listings`.
 *
 * `listings` carries a snapshot of the dwelling facts (beds / baths / living area / lot / geo) that are
 * durably owned by `properties` and `units`. That snapshot is what makes #22's search a single-table
 * indexed query and what lets a closed listing keep rendering as it was advertised after a renovation.
 *
 * It is also, by construction, capable of drifting — nothing in the database can assert
 * `listings.beds = COALESCE(unit.beds, property.beds)`, because for a terminal listing that equality is
 * deliberately false. So the containment is structural instead: exactly one function resolves the
 * snapshot from durable truth, and a test asserts no other module issues INSERT/UPDATE on `listings`.
 * If you are about to add a second write path, add it here instead.
 */

/** The narrow seam this module needs, so callers can pass a pool, a client, or a test double. */
export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

/** Durable dwelling facts resolved one level deep: the unit when subdivided, else the property. */
interface ResolvedFacts {
  beds: number | null;
  baths_full: number | null;
  baths_half: number | null;
  living_sqft: number | null;
  lot_sqft: number | null;
  year_built: number | null;
  neighborhood: string | null;
  city: string;
  state: string;
  zip5: string;
  latitude: number | null;
  longitude: number | null;
  is_sample: boolean;
}

/**
 * Reads the durable truth for a listing's dwelling.
 *
 * COALESCE(unit, property) is the resolution rule, and it is exactly one level deep. Site facts
 * (lot, year built, neighborhood, address, geo) always come from the property — a condo's lot is common
 * area, so it is never unit-scoped.
 */
async function resolveFacts(
  client: Queryable,
  propertyId: string,
  unitId: string | null,
): Promise<ResolvedFacts> {
  const { rows } = await client.query(
    `SELECT
       COALESCE(u.beds, p.beds)               AS beds,
       COALESCE(u.baths_full, p.baths_full)   AS baths_full,
       COALESCE(u.baths_half, p.baths_half)   AS baths_half,
       COALESCE(u.living_sqft, p.living_sqft) AS living_sqft,
       p.lot_sqft, p.year_built, p.neighborhood,
       p.city, p.state, p.zip5, p.latitude, p.longitude,
       (p.is_sample OR COALESCE(u.is_sample, false)) AS is_sample
     FROM properties p
     LEFT JOIN units u ON u.id = $2
     WHERE p.id = $1`,
    [propertyId, unitId],
  );
  const facts = rows[0];
  if (!facts) {
    throw new Error(`Cannot resolve dwelling facts: property ${propertyId} does not exist.`);
  }
  return facts as unknown as ResolvedFacts;
}

/**
 * Inserts a listing with its dwelling snapshot resolved from durable truth, and records a
 * `listing_events` row so the property-level history exists from the first write.
 *
 * The caller's physical fields on `row` are IGNORED — they are recomputed here. That is deliberate: a
 * caller cannot introduce a snapshot that never matched the durable rows.
 */
export async function upsertListing(client: Queryable, row: ListingRow): Promise<string> {
  await assertNotTerminal(client, row.id);
  const facts = await resolveFacts(client, row.property_id, row.unit_id);

  // PRD §6.3: a real listing can legitimately attach to a property that originated from the seed, so the
  // label is the OR across every level that contributed a displayed fact.
  const isSample = row.is_sample || facts.is_sample;

  await client.query(
    `INSERT INTO listings
       (id, property_id, unit_id, title, offer_kind, consumer_status, status, source,
        list_price, close_price, close_date,
        beds, baths_full, baths_half, living_sqft, lot_sqft, year_built,
        neighborhood, city, state, zip5, latitude, longitude,
        description, description_source, amenities,
        featured, price_reduced, new_construction,
        broker_name, broker_phone, broker_email, office_name,
        office_broker_lead_phone, office_broker_lead_email, listing_agent_name,
        is_sample, last_updated)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
             $9, $10, $11,
             $12, $13, $14, $15, $16, $17,
             $18, $19, $20, $21, $22, $23,
             $24, $25, $26,
             $27, $28, $29,
             $30, $31, $32, $33,
             $34, $35, $36,
             $37, $38)`,
    [
      row.id,
      row.property_id,
      row.unit_id,
      row.title,
      row.offer_kind,
      row.consumer_status,
      row.status,
      row.source,
      row.list_price,
      row.close_price,
      row.close_date,
      facts.beds,
      facts.baths_full,
      facts.baths_half,
      facts.living_sqft,
      facts.lot_sqft,
      facts.year_built,
      facts.neighborhood,
      facts.city,
      facts.state,
      facts.zip5,
      facts.latitude,
      facts.longitude,
      row.description,
      row.description_source,
      row.amenities,
      row.featured,
      row.price_reduced,
      row.new_construction,
      row.broker_name,
      row.broker_phone,
      row.broker_email,
      row.office_name,
      row.office_broker_lead_phone,
      row.office_broker_lead_email,
      row.listing_agent_name,
      isSample,
      row.last_updated,
    ],
  );

  await appendEvent(client, {
    listing_id: row.id,
    property_id: row.property_id,
    event_type: row.close_date ? 'closed' : 'listed',
    occurred_at: row.last_updated,
    new_price: row.close_date ? row.close_price : row.list_price,
    new_status: row.status,
    is_sample: isSample,
  });

  return row.id;
}

/**
 * Refuses to re-snapshot a listing in a terminal status.
 *
 * A closed sale is a historical record: re-resolving its snapshot after the home is renovated would
 * rewrite what the listing advertised at the time. Corrections to a terminal listing are legitimate but
 * must be explicit and audited — see `applyTerminalCorrection`.
 */
async function assertNotTerminal(client: Queryable, listingId: string): Promise<void> {
  const { rows } = await client.query(
    `SELECT s.is_terminal
       FROM listings l JOIN listing_statuses s ON s.code = l.status
      WHERE l.id = $1`,
    [listingId],
  );
  if (rows[0]?.is_terminal) {
    throw new Error(
      `Listing ${listingId} is in a terminal status; its snapshot is frozen. ` +
        'Use applyTerminalCorrection() to record an audited correction.',
    );
  }
}

/**
 * The one sanctioned way to change a terminal listing.
 *
 * Upstream corrections to closed listings are real (a corrected advertised area, a seller invoking
 * suppression after the fact). Without this the terminal freeze would leave no legal path and someone
 * would eventually write raw SQL. Every correction appends an immutable `listing_events` row.
 */
export async function applyTerminalCorrection(
  client: Queryable,
  input: {
    listingId: string;
    propertyId: string;
    reason: string;
    actor: string;
    columns: Partial<Pick<ListingRow, 'living_sqft' | 'beds' | 'close_price' | 'description'>>;
  },
): Promise<void> {
  const entries = Object.entries(input.columns).filter(([, value]) => value !== undefined);
  if (entries.length === 0) {
    throw new Error('applyTerminalCorrection requires at least one column to change.');
  }
  const assignments = entries.map(([column], index) => `${column} = $${index + 2}`).join(', ');
  await client.query(`UPDATE listings SET ${assignments} WHERE id = $1`, [
    input.listingId,
    ...entries.map(([, value]) => value),
  ]);
  await appendEvent(client, {
    listing_id: input.listingId,
    property_id: input.propertyId,
    event_type: 'correction',
    occurred_at: new Date().toISOString(),
    note: `${input.actor}: ${input.reason}`,
    is_sample: false,
  });
}

/** Append-only history. Never updated, never deleted. */
async function appendEvent(
  client: Queryable,
  event: {
    listing_id: string;
    property_id: string;
    event_type: string;
    occurred_at: string;
    new_price?: number | null;
    new_status?: string | null;
    note?: string | null;
    is_sample: boolean;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO listing_events
       (id, listing_id, property_id, event_type, occurred_at, new_price, new_status, note, is_sample)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      randomUUID(),
      event.listing_id,
      event.property_id,
      event.event_type,
      event.occurred_at,
      event.new_price ?? null,
      event.new_status ?? null,
      event.note ?? null,
      event.is_sample,
    ],
  );
}

export async function insertCommunity(client: Queryable, row: CommunityRow): Promise<void> {
  await client.query('INSERT INTO communities (id, name, is_sample) VALUES ($1, $2, $3)', [
    row.id,
    row.name,
    row.is_sample,
  ]);
}

/**
 * Resolves a property by its deduplication key, creating it only if absent, and returns the id.
 *
 * This is what makes "a property may have zero or many listings over the years" real. The previous seed
 * inserted a fresh property row for every listing with no lookup, so `properties` was 1:1 with
 * `listings` and two condos in one building became two separate buildings.
 *
 * ON CONFLICT ... DO UPDATE (rather than DO NOTHING) so the statement always RETURNs a row; touching
 * `address_raw` is a no-op write that keeps the pattern simple and the return value guaranteed.
 */
export async function getOrCreateProperty(client: Queryable, row: PropertyRow): Promise<string> {
  const { rows } = await client.query(
    `INSERT INTO properties
       (id, community_id, address_raw, street_line, city, state, zip5, address_key,
        latitude, longitude, neighborhood, property_type, year_built, lot_sqft,
        beds, baths_full, baths_half, living_sqft, is_sample)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
     ON CONFLICT (address_key) DO UPDATE SET address_raw = EXCLUDED.address_raw
     RETURNING id`,
    [
      row.id,
      row.community_id,
      row.address_raw,
      row.street_line,
      row.city,
      row.state,
      row.zip5,
      row.address_key,
      row.latitude,
      row.longitude,
      row.neighborhood,
      row.property_type,
      row.year_built,
      row.lot_sqft,
      row.beds,
      row.baths_full,
      row.baths_half,
      row.living_sqft,
      row.is_sample,
    ],
  );
  return requireId(rows, 'properties');
}

/**
 * Resolves a unit within a property, creating it only if absent.
 *
 * The unique index is NULLS NOT DISTINCT on (property_id, unit_number), so two feeds cannot create
 * unit '4B' twice and at most one whole-property unit row can exist.
 */
export async function getOrCreateUnit(client: Queryable, row: UnitRow): Promise<string> {
  const { rows } = await client.query(
    `INSERT INTO units
       (id, property_id, unit_number, floor, beds, baths_full, baths_half, living_sqft, is_sample)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (property_id, unit_number) DO UPDATE SET floor = EXCLUDED.floor
     RETURNING id`,
    [
      row.id,
      row.property_id,
      row.unit_number,
      row.floor,
      row.beds,
      row.baths_full,
      row.baths_half,
      row.living_sqft,
      row.is_sample,
    ],
  );
  return requireId(rows, 'units');
}

/**
 * An upsert with `RETURNING id` always yields a row, so an empty result means the statement did not do
 * what this module assumes. Failing loudly beats returning `undefined` as an id and writing a listing
 * that references nothing.
 */
function requireId(rows: Record<string, unknown>[], table: string): string {
  const id = rows[0]?.id;
  if (typeof id !== 'string') {
    throw new Error(`Upsert on ${table} returned no id.`);
  }
  return id;
}

export async function insertOpenHouse(client: Queryable, row: OpenHouseRow): Promise<void> {
  await client.query(
    `INSERT INTO listing_open_houses (id, listing_id, starts_at, ends_at, is_sample)
     VALUES ($1, $2, $3, $4, $5)`,
    [row.id, row.listing_id, row.starts_at, row.ends_at, row.is_sample],
  );
}

export async function insertMedia(client: Queryable, rows: MediaRow[]): Promise<void> {
  for (const row of rows) {
    await client.query(
      `INSERT INTO listing_media (id, listing_id, source_url, sort_order, is_primary, is_sample)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [row.id, row.listing_id, row.source_url, row.sort_order, row.is_primary, row.is_sample],
    );
  }
}
