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
        source_system, source_listing_key, source_listing_id, source_modification_timestamp,
        list_price, close_price, close_date,
        beds, baths_full, baths_half, living_sqft, lot_sqft, year_built,
        neighborhood, city, state, zip5, latitude, longitude,
        description, description_source, description_moderation, amenities,
        featured, featured_reason, price_reduced, new_construction,
        internet_display_allowed, address_display_allowed,
        price_display_allowed, price_history_display_allowed, media_display_allowed,
        days_on_market_display_allowed, days_on_market,
        broker_name, broker_phone, broker_email, office_name,
        office_broker_lead_phone, office_broker_lead_email, listing_agent_name,
        is_sample, last_updated)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
             $9, $10, $11, $12,
             $13, $14, $15,
             $16, $17, $18, $19, $20, $21,
             $22, $23, $24, $25, $26, $27,
             $28, $29, $30, $31,
             $32, $33, $34, $35,
             $36, $37,
             $38, $39, $40,
             $41, $42,
             $43, $44, $45, $46,
             $47, $48, $49,
             $50, $51)
     -- Re-ingesting the same feed record (source_system, source_listing_key) reuses the SAME id
     -- (resolved by the caller, see upsertListingBySourceKey), so this is the idempotent re-run
     -- path (#93): every column the INSERT list carries is also refreshed on conflict.
     ON CONFLICT (id) DO UPDATE SET
       title = EXCLUDED.title,
       consumer_status = EXCLUDED.consumer_status,
       status = EXCLUDED.status,
       source_system = EXCLUDED.source_system,
       source_listing_id = EXCLUDED.source_listing_id,
       source_modification_timestamp = EXCLUDED.source_modification_timestamp,
       list_price = EXCLUDED.list_price,
       close_price = EXCLUDED.close_price,
       close_date = EXCLUDED.close_date,
       beds = EXCLUDED.beds,
       baths_full = EXCLUDED.baths_full,
       baths_half = EXCLUDED.baths_half,
       living_sqft = EXCLUDED.living_sqft,
       lot_sqft = EXCLUDED.lot_sqft,
       year_built = EXCLUDED.year_built,
       neighborhood = EXCLUDED.neighborhood,
       city = EXCLUDED.city,
       state = EXCLUDED.state,
       zip5 = EXCLUDED.zip5,
       latitude = EXCLUDED.latitude,
       longitude = EXCLUDED.longitude,
       description = EXCLUDED.description,
       description_source = EXCLUDED.description_source,
       description_moderation = EXCLUDED.description_moderation,
       amenities = EXCLUDED.amenities,
       internet_display_allowed = EXCLUDED.internet_display_allowed,
       address_display_allowed = EXCLUDED.address_display_allowed,
       price_display_allowed = EXCLUDED.price_display_allowed,
       price_history_display_allowed = EXCLUDED.price_history_display_allowed,
       media_display_allowed = EXCLUDED.media_display_allowed,
       days_on_market_display_allowed = EXCLUDED.days_on_market_display_allowed,
       days_on_market = EXCLUDED.days_on_market,
       broker_name = EXCLUDED.broker_name,
       broker_phone = EXCLUDED.broker_phone,
       broker_email = EXCLUDED.broker_email,
       office_name = EXCLUDED.office_name,
       office_broker_lead_phone = EXCLUDED.office_broker_lead_phone,
       office_broker_lead_email = EXCLUDED.office_broker_lead_email,
       listing_agent_name = EXCLUDED.listing_agent_name,
       last_updated = EXCLUDED.last_updated`,
    [
      row.id,
      row.property_id,
      row.unit_id,
      row.title,
      row.offer_kind,
      row.consumer_status,
      row.status,
      row.source,
      row.source_system ?? null,
      row.source_listing_key ?? null,
      row.source_listing_id ?? null,
      row.source_modification_timestamp ?? null,
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
      row.description_moderation,
      row.amenities,
      row.featured,
      row.featured_reason,
      row.price_reduced,
      row.new_construction,
      // The two RESO seller display-suppression flags. Bound explicitly and never defaulted here:
      // the columns default to `true` in the database, so a caller that omitted them would publish a
      // listing the seller withheld, with no error anywhere. `ListingRow` makes them required so
      // that omission is a compile error rather than a runtime disclosure.
      row.internet_display_allowed,
      row.address_display_allowed,
      // #53. Bright's field-level suppression flags — the same "required, bound explicitly, never
      // defaulted here" reasoning as the two flags above.
      row.price_display_allowed,
      row.price_history_display_allowed,
      row.media_display_allowed,
      row.days_on_market_display_allowed,
      row.days_on_market,
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
 * Idempotent upsert keyed on the feed's own identity, `(source_system, source_listing_key)` — the
 * natural key a re-ingested MLS record carries, not the internal `id` a caller could otherwise mint
 * fresh on every pass and duplicate the listing (#93).
 *
 * Resolves the existing `id` for that key, if any, then delegates to `upsertListing()` with that same
 * `id` so its `ON CONFLICT (id) DO UPDATE` — and its terminal-freeze check — apply unchanged. A
 * terminal listing is left untouched rather than re-snapshotted: `upsertListing()` throws on that
 * path, so a re-run of the same batch fails on the very record the freeze exists to protect. Callers
 * that map from a staging table are expected to be re-run after correcting a rejection, not to retry
 * every record blindly — this returns the frozen id for a terminal match instead of throwing.
 */
export async function upsertListingBySourceKey(
  client: Queryable,
  row: Omit<ListingRow, 'id'> & { source_system: string; source_listing_key: string },
): Promise<string> {
  const { rows: existing } = await client.query(
    `SELECT l.id, s.is_terminal
       FROM listings l JOIN listing_statuses s ON s.code = l.status
      WHERE l.source_system = $1 AND l.source_listing_key = $2`,
    [row.source_system, row.source_listing_key],
  );
  const existingId = existing[0]?.id;
  if (typeof existingId === 'string' && existing[0]?.is_terminal) {
    return existingId;
  }
  const id = typeof existingId === 'string' ? existingId : randomUUID();
  return upsertListing(client, { ...row, id });
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
 * Refuses a correction to a listing that is NOT terminal.
 *
 * The mirror of `assertNotTerminal`, and the reason this function's name is a contract rather than a
 * suggestion. A live listing must go through `upsertListing()`, which re-resolves the snapshot from
 * durable truth; letting a "correction" write those columns directly would be a second write path
 * into `listings` that sets values the resolver never produced — precisely the containment this
 * module exists to provide.
 */
async function assertTerminal(client: Queryable, listingId: string): Promise<void> {
  const { rows } = await client.query(
    `SELECT s.is_terminal
       FROM listings l JOIN listing_statuses s ON s.code = l.status
      WHERE l.id = $1`,
    [listingId],
  );
  const status = rows[0];
  if (!status) {
    throw new Error(`Listing ${listingId} does not exist.`);
  }
  if (!status.is_terminal) {
    throw new Error(
      `Listing ${listingId} is not in a terminal status; corrections are only for frozen ` +
        'listings. Use upsertListing() so the snapshot is resolved from the durable rows.',
    );
  }
}

/**
 * The only columns a correction may touch, enforced at runtime rather than by the type alone.
 *
 * The UPDATE below interpolates these keys straight into SQL — they are identifiers, so they cannot
 * be bound as parameters. TypeScript stops that at compile time for ordinary callers, but a `as any`
 * cast or an unvalidated request body reaching this function would otherwise let the caller name any
 * column in `listings`, including the status and display-suppression flags.
 */
const CORRECTABLE_COLUMNS = ['living_sqft', 'beds', 'close_price', 'description'] as const;

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
  const rejected = entries
    .map(([column]) => column)
    .filter((column) => !(CORRECTABLE_COLUMNS as readonly string[]).includes(column));
  if (rejected.length > 0) {
    throw new Error(
      `applyTerminalCorrection cannot change: ${rejected.join(', ')}. ` +
        `Correctable columns are ${CORRECTABLE_COLUMNS.join(', ')}.`,
    );
  }
  await assertTerminal(client, input.listingId);
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
 * Corrects the address of the property an EXISTING feed listing already points at, and returns
 * that property's id — or `null` when the feed has no listing under this key yet.
 *
 * `getOrCreateProperty()` keys on `address_key`, so a mapper fix that changes how a street line is
 * composed yields a new key and would create a second property, while `upsertListing()` never moves
 * a listing's `property_id`: the listing would keep rendering its old address forever. Refreshing
 * in place fixes it on the next pass in every environment, with nothing deleted.
 *
 * Skipped (returns `null`) when another property already holds the new key: that is two feed
 * records resolving to one building, and merging them is a dedup decision, not an address fix.
 */
export async function refreshFeedPropertyAddress(
  client: Queryable,
  sourceSystem: string,
  sourceListingKey: string,
  row: Pick<PropertyRow, 'address_raw' | 'street_line' | 'city' | 'address_key'>,
): Promise<string | null> {
  const { rows } = await client.query(
    `UPDATE properties p
        SET street_line = $3, address_raw = $4, city = $5, address_key = $6
       FROM listings l
      WHERE l.property_id = p.id
        AND l.source_system = $1
        AND l.source_listing_key = $2
        AND NOT EXISTS (SELECT 1 FROM properties q WHERE q.address_key = $6 AND q.id <> p.id)
      RETURNING p.id`,
    [sourceSystem, sourceListingKey, row.street_line, row.address_raw, row.city, row.address_key],
  );
  const id = rows[0]?.id;
  return typeof id === 'string' ? id : null;
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
export function requireId(rows: Record<string, unknown>[], table: string): string {
  const id = rows[0]?.id;
  if (typeof id !== 'string') {
    throw new Error(`Upsert on ${table} returned no id.`);
  }
  return id;
}

/**
 * `remarks` and `is_cancelled` were previously absent from both `OpenHouseRow` and this INSERT, which
 * made two things untestable and one field permanently dead: `openHouse.remarks` is declared by the
 * wire contract but could never be non-null, and `listing_search_v` filters cancelled occurrences out
 * without any writer being able to create one to exclude.
 */
export async function insertOpenHouse(client: Queryable, row: OpenHouseRow): Promise<void> {
  await client.query(
    `INSERT INTO listing_open_houses
       (id, listing_id, starts_at, ends_at, remarks, is_cancelled, is_sample)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      row.id,
      row.listing_id,
      row.starts_at,
      row.ends_at,
      row.remarks,
      row.is_cancelled,
      row.is_sample,
    ],
  );
}

/**
 * `alt_text` was previously absent from both `MediaRow` and this INSERT (#105), which made the
 * column permanently NULL and the address suppression over it permanently untestable — a test that
 * cannot fail. It is feed-authored free text: MLS photo captions routinely carry the street line
 * ("Front elevation, 123 Maple St"), so on an address-suppressed listing it is the same class of
 * leak #59 closed for `title`/`description`/`open_house_remarks`, withheld at the response boundary
 * (`src/listings/suppression.ts`) because both endpoints read `listing_media` through LATERAL joins
 * that bypass `listing_search_v` entirely.
 */
export async function insertMedia(client: Queryable, rows: MediaRow[]): Promise<void> {
  for (const row of rows) {
    await client.query(
      `INSERT INTO listing_media
         (id, listing_id, source_url, alt_text, sort_order, is_primary,
          retained_when_suppressed, is_sample)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        row.id,
        row.listing_id,
        row.source_url,
        row.alt_text,
        row.sort_order,
        row.is_primary,
        // #53. The explicit retained-photo marker. Bound explicitly, never defaulted here, for the
        // same reason alt_text is: MediaRow requires it so a mapper must declare it.
        row.retained_when_suppressed,
        row.is_sample,
      ],
    );
  }
}

/** One feed-sourced photo, already ordered by `buildListingGallery()` (#191). */
export interface FeedMediaRow {
  /** `MediaKey`. The idempotency key, and what tells a feed row from a seeded one. */
  readonly source_media_key: string;
  readonly source_url: string;
  readonly alt_text: string | null;
  readonly caption: string | null;
  readonly sort_order: number;
  readonly is_primary: boolean;
  readonly is_sample: boolean;
}

/**
 * Replaces one listing's FEED-SOURCED media with the gallery a mapping pass produced (#191).
 *
 * `insertMedia()` above is the seed path: it inserts and never reconciles, because a re-seed
 * deletes first. A feed pass cannot work that way. It re-reads the same listings every run, so it
 * needs an idempotent write, and a photo withdrawn at the MLS has to leave.
 *
 * Three statements, in an order the indexes dictate rather than one chosen for readability.
 *
 *  1. **Clear `is_primary` first, on EVERY row of the listing.** `idx_listing_media_one_primary` is
 *     a partial unique index on `listing_id WHERE is_primary`, so a listing may hold exactly one
 *     primary row of any origin. Promoting the feed's primary before demoting the incumbent
 *     violates it, and that is the ordinary case: any reordered gallery hits it. The clear is
 *     deliberately NOT scoped to `source_media_key IS NOT NULL`, unlike statement 3. A seeded photo
 *     holding `is_primary` would otherwise block the feed's primary with an index violation, and
 *     failing the run over a photo ordering is worse than demoting a seeded row. Statement 3's
 *     "never touched" claim is about DELETION, which is a different guarantee.
 *  2. **Upsert on `(listing_id, source_media_key)`, one multi-row statement.** That index is
 *     partial too (`WHERE source_media_key IS NOT NULL`), so the conflict target repeats the
 *     predicate. Without it Postgres cannot infer the index and answers "no unique or exclusion
 *     constraint matching". One statement rather than one per photo: a pass rewrites every matched
 *     listing's whole gallery on every run, so a round trip per photo is O(total staged media) per
 *     run and does not fit the CronJob's deadline at real volume.
 *  3. **Delete the feed rows this pass did not send.** Scoped to `source_media_key IS NOT NULL`, so
 *     a seeded or hand-inserted photo on the same listing is never deleted. This is the
 *     purge-on-withdrawal path the `listing_media` migration was designed for.
 *
 * **Caller supplies the transaction.** The three statements must commit together, or a pod killed
 * mid-sequence leaves a listing with no primary image, duplicate sort orders, or withdrawn photos
 * still visible. `mapStagedBrightMedia` opens one per listing.
 */
export async function replaceFeedListingMedia(
  client: Queryable,
  listingId: string,
  rows: readonly FeedMediaRow[],
): Promise<void> {
  await client.query(
    'UPDATE listing_media SET is_primary = false WHERE listing_id = $1 AND is_primary',
    [listingId],
  );

  if (rows.length > 0) {
    const values: unknown[] = [listingId];
    const tuples = rows.map((row) => {
      // $1 is the listing id, shared by every tuple. Each row then binds 8 of its own.
      const base = values.length;
      values.push(
        randomUUID(),
        row.source_media_key,
        row.source_url,
        row.alt_text,
        row.caption,
        row.sort_order,
        row.is_primary,
        row.is_sample,
      );
      return (
        `($${base + 1}, $1, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, ` +
        `$${base + 6}, $${base + 7}, false, $${base + 8})`
      );
    });

    await client.query(
      `INSERT INTO listing_media
         (id, listing_id, source_media_key, source_url, alt_text, caption, sort_order,
          is_primary, retained_when_suppressed, is_sample)
       VALUES ${tuples.join(', ')}
       ON CONFLICT (listing_id, source_media_key) WHERE source_media_key IS NOT NULL
       DO UPDATE SET
         source_url = EXCLUDED.source_url,
         alt_text = EXCLUDED.alt_text,
         caption = EXCLUDED.caption,
         sort_order = EXCLUDED.sort_order,
         is_primary = EXCLUDED.is_primary,
         is_sample = EXCLUDED.is_sample`,
      values,
    );
  }

  // `retained_when_suppressed` is bound false above and is deliberately NOT in the DO UPDATE list.
  // It is #146's marker for the one photo a media-suppressed listing keeps, set by a rule that
  // still waits on #33 item 8(f). A feed pass must neither set it nor clear one already set.
  await client.query(
    `DELETE FROM listing_media
      WHERE listing_id = $1
        AND source_media_key IS NOT NULL
        AND NOT (source_media_key = ANY($2::text[]))`,
    [listingId, rows.map((row) => row.source_media_key)],
  );
}

/** `source_media_key` of the `ListPictureURL` fallback photo. A real `MediaKey` is numeric. */
export const LIST_PICTURE_MEDIA_KEY = 'list-picture';

/**
 * Gives a feed listing its `ListPictureURL` as the primary photo until the `BrightMedia` crawl
 * (#191) delivers its gallery.
 *
 * The crawl is a full pass over `BrightMedia` and takes hours on the production feed, while every
 * property record already carries its main photo. So the mapper writes that one photo, under
 * `LIST_PICTURE_MEDIA_KEY`, only while the listing holds no other feed photo. When the crawl writes
 * the gallery, `replaceFeedListingMedia()` deletes every feed row not in its set, and this one goes
 * with them. Not a second gallery source: it never runs once a crawled photo exists.
 */
export async function ensureListPicturePhoto(
  client: Queryable,
  listingId: string,
  url: string,
  isSample: boolean,
): Promise<void> {
  await client.query(
    `INSERT INTO listing_media
       (id, listing_id, source_media_key, source_url, alt_text, caption, sort_order,
        is_primary, retained_when_suppressed, is_sample)
     SELECT $1, $2, $3, $4, NULL, NULL, 0, true, false, $5
      WHERE NOT EXISTS (
        SELECT 1 FROM listing_media
         WHERE listing_id = $2 AND (is_primary OR source_media_key IS NOT NULL)
           AND source_media_key IS DISTINCT FROM $3)
     ON CONFLICT (listing_id, source_media_key) WHERE source_media_key IS NOT NULL
     DO UPDATE SET source_url = EXCLUDED.source_url, is_sample = EXCLUDED.is_sample`,
    [randomUUID(), listingId, LIST_PICTURE_MEDIA_KEY, url, isSample],
  );
}

/**
 * The ordered `DELETE`s that a sample re-seed performs. Exported so a test can assert the invariant
 * that matters most about them — every single one is scoped on `is_sample = true` — rather than
 * trusting a reviewer to re-read the list.
 *
 * Every statement narrows to sample data, but note that the FIRST one qualifies on its parent
 * listing's flag rather than its own — see the comment on it; `is_sample = true` still appears in
 * every statement, which is what the accompanying test asserts.
 *
 * ORDER IS LOAD-BEARING, and it is dictated by the foreign keys rather than chosen:
 *   - `listing_events` is `ON DELETE RESTRICT` on both `listings` and `properties` (history is
 *     append-only, deliberately), so it must go first or the listings delete fails.
 *   - `listing_media` and `listing_open_houses` would cascade, but are deleted explicitly anyway:
 *     relying on a cascade means the `is_sample` scope is implied rather than stated, and a cascade
 *     from a wrongly-scoped parent delete would take non-sample children with it silently.
 *   - `listings` is `ON DELETE RESTRICT` on `properties`/`units`, so the durable rows come last.
 *
 * The three durable tables additionally refuse to delete a row anything still references, so a
 * property shared with a real (non-sample) listing survives even though it is itself `is_sample` —
 * exactly the PRD §6.3 case where real inventory attaches to a property the seed created.
 */
export const SAMPLE_DATA_DELETE_STATEMENTS: readonly string[] = [
  // Scoped by PARENTAGE, not by the event's own flag, and that difference is load-bearing.
  // `applyTerminalCorrection()` appends its correction event with `is_sample: false` unconditionally
  // (see its call to `appendEvent`), so a correction applied to a sample listing leaves an event this
  // sweep would skip — and the very next statement then hits `listing_events`' ON DELETE RESTRICT on
  // `listings` and rolls the whole transaction back. That would fail the migrate initContainer on
  // every boot, forever, until someone deleted the row by hand. Deleting the history of the listings
  // being deleted makes the sweep complete by construction instead of by coincidence.
  `DELETE FROM listing_events e
    USING listings l
    WHERE e.listing_id = l.id
      AND l.is_sample = true`,
  'DELETE FROM listing_media WHERE is_sample = true',
  'DELETE FROM listing_open_houses WHERE is_sample = true',
  'DELETE FROM listings WHERE is_sample = true',
  `DELETE FROM units u
    WHERE u.is_sample = true
      AND NOT EXISTS (SELECT 1 FROM listings l WHERE l.unit_id = u.id)`,
  `DELETE FROM properties p
    WHERE p.is_sample = true
      AND NOT EXISTS (SELECT 1 FROM listings l WHERE l.property_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM units u WHERE u.property_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM listing_events e WHERE e.property_id = p.id)`,
  `DELETE FROM communities c
    WHERE c.is_sample = true
      AND NOT EXISTS (SELECT 1 FROM properties p WHERE p.community_id = c.id)`,
];

/**
 * Removes every sample row so the current dataset can be inserted fresh (#111).
 *
 * Delete-then-insert rather than upsert, for a reason upsert cannot address: a listing REMOVED from
 * `mock-listings.ts` has to actually disappear, and no upsert expresses that. It also sidesteps the
 * terminal-snapshot freeze instead of fighting it — `applyTerminalCorrection()` is the audited path
 * for changing one closed listing, not a bulk re-seed mechanism.
 *
 * This lives in `write.ts` because it writes `listings`, and this module is the only one permitted
 * to (`seed.spec.ts` asserts it, for DELETE as well as INSERT/UPDATE). It takes a `Queryable`, never
 * a pool: the caller must already be inside the seeding transaction, so a failed insert rolls the
 * deletes back with it and the database is never left empty.
 */
export async function deleteSampleData(client: Queryable): Promise<void> {
  for (const statement of SAMPLE_DATA_DELETE_STATEMENTS) {
    await client.query(statement);
  }
}
