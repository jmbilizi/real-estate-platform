/**
 * Maps `bright_staging_records` into the consumer schema (#93).
 *
 * This is the impure half of the mapper: it reads staging, calls the pure `mapBrightPropertyRecord`
 * from `map-record.ts`, and writes through `src/db/write.ts` — the only module allowed to write
 * `properties`/`units`/`listings`. It never re-queries Bright: a mapping bug is fixed and this run
 * re-processes the same staged rows, which is why `upsertListingBySourceKey` must be idempotent.
 *
 * Called from `src/jobs/bright-ingest/run.ts` after a replication pass, per the ticket's own
 * direction ("runs inside #91's job after #92's pass"). Kept in its own directory rather than
 * `bright-ingest/` because that directory's `no-consumer-writes.spec.ts` is a structural allowlist
 * that forbids importing `db/write` — this module's whole job is to use it.
 */

import {
  ensureListPicturePhoto,
  getOrCreateProperty,
  getOrCreateUnit,
  Queryable,
  refreshFeedPropertyAddress,
  replaceFeedListingMedia,
  upsertListingBySourceKey,
} from '../../db/write';
import { PropertyRow, UnitRow } from '../../seed/types';
import { randomUUID } from 'node:crypto';

import { buildListingGallery, mapBrightMediaRecord, type MappedBrightMedia } from './map-media';
import { mapBrightPropertyRecord } from './map-record';
import {
  BrightMapRunReport,
  type BrightMediaMapReport,
  ZERO_MAP_REPORT,
  ZERO_MEDIA_MAP_REPORT,
} from './report';
import { BrightFeedTier } from './sample';
import { ListingStatusLookup } from './status';

const SOURCE_SYSTEM = 'BrightMLS';
const RESOURCE = 'BrightProperties';
const MEDIA_RESOURCE = 'BrightMedia';

export interface MapStagedBrightPropertiesOptions {
  readonly feed: BrightFeedTier;
  /** Configured licensed display-delay window for solds, in days. `null` = unconfigured, fail closed. */
  readonly soldDisplayDelayDays: number | null;
  /** Map only these staged `ListingKey`s (the on-demand area load). Absent maps every staged row. */
  readonly listingKeys?: readonly string[];
  /**
   * The vocabulary to map against. Absent re-reads `listing_statuses`. A caller that already loaded
   * it this request (the on-demand loader, to derive its searchable-status set) passes it through
   * instead, so one request does not query the table twice.
   */
  readonly statuses?: readonly ListingStatusLookup[];
}

/** Reads the current vocabulary, so an added `listing_statuses` row needs no code change here. */
export async function loadListingStatuses(client: Queryable): Promise<ListingStatusLookup[]> {
  const { rows } = await client.query(
    // ORDER BY sort_order: two codes ('Hold' and 'Temporarily Off Market') share the same
    // reso_standard_status ('Hold'). mapStandardStatus() takes the first array match, so the order
    // here — not incidental — decides which code an ambiguous Bright value resolves to.
    'SELECT code, consumer_status, is_terminal, reso_standard_status, is_publicly_searchable ' +
      'FROM listing_statuses ORDER BY sort_order',
  );
  return rows.map((row) => ({
    code: String(row.code),
    consumerStatus: (row.consumer_status ?? null) as ListingStatusLookup['consumerStatus'],
    isTerminal: Boolean(row.is_terminal),
    resoStandardStatus: (row.reso_standard_status ?? null) as string | null,
    isPubliclySearchable: Boolean(row.is_publicly_searchable),
  }));
}

interface StagedRow {
  readonly record_key: string;
  readonly payload: unknown;
}

/** Scoped to `feed`, so a leftover row from the other tier is never mapped (#314). */
async function loadStagedRecords(
  client: Queryable,
  feed: BrightFeedTier,
  listingKeys: readonly string[] | undefined,
): Promise<StagedRow[]> {
  const { rows } =
    listingKeys === undefined
      ? await client.query(
          'SELECT record_key, payload FROM bright_staging_records WHERE resource = $1 AND feed_tier = $2',
          [RESOURCE, feed],
        )
      : await client.query(
          `SELECT record_key, payload FROM bright_staging_records
            WHERE resource = $1 AND feed_tier = $2 AND record_key = ANY($3::text[])`,
          [RESOURCE, feed, listingKeys],
        );
  return rows as unknown as StagedRow[];
}

/** An absolute http(s) `ListPictureURL`, or `null`. Bright serves these over plain http. */
function listPictureUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function mapStagedBrightProperties(
  client: Queryable,
  options: MapStagedBrightPropertiesOptions,
): Promise<BrightMapRunReport> {
  const staged = await loadStagedRecords(client, options.feed, options.listingKeys);
  if (staged.length === 0) {
    return ZERO_MAP_REPORT;
  }

  const statuses = options.statuses ?? (await loadListingStatuses(client));
  const withheldByReason: Record<string, number> = {};
  const outOfRangeFieldCounts: Record<string, number> = {};
  const publishedListingKeys: string[] = [];
  let mapped = 0;
  let published = 0;
  let takenDown = 0;
  let sampleMarked = 0;

  for (const row of staged) {
    const payload =
      typeof row.payload === 'string'
        ? (JSON.parse(row.payload) as Record<string, unknown>)
        : (row.payload as Record<string, unknown>);

    const result = mapBrightPropertyRecord(payload, {
      feed: options.feed,
      statuses,
      soldDisplayDelayDays: options.soldDisplayDelayDays,
    });

    if (result.kind === 'rejected') {
      withheldByReason[result.reason] = (withheldByReason[result.reason] ?? 0) + 1;
      continue;
    }

    mapped += 1;

    for (const field of result.outOfRangeFields) {
      outOfRangeFieldCounts[field] = (outOfRangeFieldCounts[field] ?? 0) + 1;
    }

    const propertyRow: PropertyRow = { id: randomUUID(), community_id: null, ...result.property };
    // An already-mapped listing keeps its property, with the address corrected in place.
    const propertyId =
      (await refreshFeedPropertyAddress(client, SOURCE_SYSTEM, result.listingKey, propertyRow)) ??
      (await getOrCreateProperty(client, propertyRow));

    let unitId: string | null = null;
    if (result.unitNumber) {
      const unitRow: UnitRow = {
        id: randomUUID(),
        property_id: propertyId,
        unit_number: result.unitNumber,
        floor: null,
        beds: null,
        baths_full: null,
        baths_half: null,
        living_sqft: null,
        is_sample: result.property.is_sample,
      };
      unitId = await getOrCreateUnit(client, unitRow);
    }

    const { listing } = result;
    const listingId = await upsertListingBySourceKey(client, {
      property_id: propertyId,
      unit_id: unitId,
      title: listing.title,
      offer_kind: listing.offerKind,
      consumer_status: listing.consumerStatus,
      status: listing.status,
      source: 'brightMLS',
      source_system: SOURCE_SYSTEM,
      source_listing_key: result.listingKey,
      source_listing_id: result.listingKey,
      source_modification_timestamp: null,
      list_price: listing.listPrice,
      close_price: listing.closePrice,
      close_date: listing.closeDate,
      beds: null,
      baths_full: null,
      baths_half: null,
      living_sqft: null,
      lot_sqft: null,
      year_built: null,
      neighborhood: null,
      city: result.property.city,
      state: result.property.state,
      zip5: result.property.zip5,
      latitude: null,
      longitude: null,
      description: listing.description,
      description_source: listing.description ? 'mls_remarks' : null,
      amenities: [],
      description_moderation: 'approved',
      featured: false,
      featured_reason: null,
      price_reduced: false,
      new_construction: false,
      internet_display_allowed: listing.suppression.internetDisplayAllowed,
      address_display_allowed: listing.suppression.addressDisplayAllowed,
      price_display_allowed: listing.suppression.priceDisplayAllowed,
      price_history_display_allowed: listing.suppression.priceHistoryDisplayAllowed,
      media_display_allowed: listing.suppression.mediaDisplayAllowed,
      days_on_market_display_allowed: listing.suppression.daysOnMarketDisplayAllowed,
      days_on_market: null,
      broker_name: listing.attribution.brokerName,
      broker_phone: listing.attribution.brokerPhone,
      broker_email: listing.attribution.brokerEmail,
      office_name: listing.attribution.officeName,
      office_broker_lead_phone: listing.attribution.officeBrokerLeadPhone,
      office_broker_lead_email: listing.attribution.officeBrokerLeadEmail,
      listing_agent_name: listing.attribution.listingAgentName,
      is_sample: listing.isSample,
      last_updated: listing.lastUpdated,
    });

    // The main photo until the BrightMedia crawl (#191) delivers the gallery. See write.ts.
    const listPicture = listPictureUrl(payload.ListPictureURL);
    if (listPicture !== null) {
      await ensureListPicturePhoto(client, listingId, listPicture, listing.isSample);
    }

    if (listing.isSample) {
      sampleMarked += 1;
    }
    if (listing.consumerStatus === null) {
      takenDown += 1;
    } else if (listing.suppression.internetDisplayAllowed) {
      published += 1;
      publishedListingKeys.push(result.listingKey);
    }
  }

  const withheld = Object.values(withheldByReason).reduce((total, count) => total + count, 0);

  return {
    staged: staged.length,
    mapped,
    published,
    publishedListingKeys,
    withheld,
    withheldByReason,
    takenDown,
    sampleMarked,
    outOfRangeFieldCounts,
  };
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * Media mapping (#191)
 * ════════════════════════════════════════════════════════════════════════════════════════════ */

interface ListingRef {
  readonly id: string;
  readonly isSample: boolean;
}

/**
 * Resolves staged `ListingKey`s to listing rows this service already holds.
 *
 * Keyed on `(source_system, source_listing_key)`, never on `source_listing_key` alone. The key is
 * an MLS counter, so two originating systems can issue the same one. PRD §1 requires the mapping
 * table to be keyed by originating system for that reason.
 *
 * Chunked, because a crawl can hold media for more listings than one `ANY($1)` should carry.
 */
async function loadListingRefs(
  client: Queryable,
  listingKeys: readonly string[],
): Promise<Map<string, ListingRef>> {
  const refs = new Map<string, ListingRef>();
  const CHUNK = 500;
  for (let start = 0; start < listingKeys.length; start += CHUNK) {
    const chunk = listingKeys.slice(start, start + CHUNK);
    const { rows } = await client.query(
      `SELECT id, source_listing_key, is_sample
         FROM listings
        WHERE source_system = $1 AND source_listing_key = ANY($2::text[])`,
      [SOURCE_SYSTEM, chunk],
    );
    for (const row of rows) {
      refs.set(String(row.source_listing_key), {
        id: String(row.id),
        isSample: Boolean(row.is_sample),
      });
    }
  }
  return refs;
}

/**
 * Counts Bright listings this service holds that carry no feed photo (#191).
 *
 * Measured against `listings`, never against the media this pass happened to see. An earlier
 * version derived it from the pass's own lookup map, where it was always zero by construction — a
 * counter that could not report the condition it existed to report.
 *
 * This is the headline anomaly signal. A run where it equals the Bright listing count is the #191
 * defect returning, whatever the other counters say.
 */
async function countBrightListingsWithNoMedia(client: Queryable): Promise<number> {
  const { rows } = await client.query(
    `SELECT count(*)::int AS n
       FROM listings l
      WHERE l.source_system = $1
        AND NOT EXISTS (
          SELECT 1 FROM listing_media m
           WHERE m.listing_id = l.id AND m.source_media_key IS NOT NULL
        )`,
    [SOURCE_SYSTEM],
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * Maps staged `BrightMedia` rows into `listing_media` (#191).
 *
 * Runs AFTER `mapStagedBrightProperties`, and the order is load-bearing: a photo needs its listing
 * row to exist before it can reference one. A media row whose listing is absent is counted as
 * `unmatchedMedia` and dropped. It is never used to create a listing — this pass writes photos,
 * and a listing conjured from a photo would carry none of the fields the display rules gate on.
 *
 * Idempotent. It re-reads the same staged rows every run, and `replaceFeedListingMedia()`
 * reconciles instead of appending. So a mapping fix is deployed and the next run repairs the
 * gallery, with no manual cleanup.
 */
export async function mapStagedBrightMedia(
  client: Queryable,
  /** Scopes the staged rows read to this run's tier (#314). */
  feed: BrightFeedTier,
  /** Map only these listings' staged media (the per-listing gallery fetch). Absent maps all. */
  listingKeys?: readonly string[],
): Promise<BrightMediaMapReport> {
  const { rows: staged } =
    listingKeys === undefined
      ? await client.query(
          'SELECT payload FROM bright_staging_records WHERE resource = $1 AND feed_tier = $2',
          [MEDIA_RESOURCE, feed],
        )
      : await client.query(
          `SELECT payload FROM bright_staging_records
            WHERE resource = $1 AND feed_tier = $2 AND payload->>'ResourceRecordKey' = ANY($3::text[])`,
          [MEDIA_RESOURCE, feed, listingKeys],
        );
  if (staged.length === 0) {
    return ZERO_MEDIA_MAP_REPORT;
  }

  const byListingKey = new Map<string, MappedBrightMedia[]>();
  const rejectedByReason: Record<string, number> = {};
  let mapped = 0;
  let rejected = 0;

  for (const row of staged) {
    const payload =
      typeof row.payload === 'string'
        ? (JSON.parse(row.payload) as Record<string, unknown>)
        : (row.payload as Record<string, unknown>);

    const result = mapBrightMediaRecord(payload);
    if (result.kind === 'rejected') {
      rejected += 1;
      rejectedByReason[result.reason] = (rejectedByReason[result.reason] ?? 0) + 1;
      continue;
    }
    mapped += 1;
    const group = byListingKey.get(result.media.listingKey);
    if (group === undefined) {
      byListingKey.set(result.media.listingKey, [result.media]);
    } else {
      group.push(result.media);
    }
  }

  const refs = await loadListingRefs(client, [...byListingKey.keys()]);

  let unmatchedMedia = 0;
  let listingsWithMedia = 0;
  let mediaWritten = 0;

  for (const [listingKey, group] of byListingKey) {
    const ref = refs.get(listingKey);
    if (ref === undefined) {
      unmatchedMedia += group.length;
      continue;
    }
    const gallery = buildListingGallery(group);
    // ONE transaction per listing. `replaceFeedListingMedia` issues three statements that must
    // commit together: a pod killed between them leaves the gallery with no primary image, or with
    // withdrawn photos still visible. Per listing rather than per pass, because a pass can hold
    // media for thousands of listings and one transaction over all of them holds locks for the
    // whole run.
    await client.query('BEGIN');
    try {
      await replaceFeedListingMedia(
        client,
        ref.id,
        gallery.map((item) => ({
          source_media_key: item.sourceMediaKey,
          source_url: item.url,
          alt_text: item.altText,
          caption: item.caption,
          sort_order: item.sortOrder,
          is_primary: item.isPrimary,
          // Carried from the listing, never assumed false. A sample-tier Bright listing's photos
          // must be swept by the same `is_sample` delete that removes the listing (#93).
          is_sample: ref.isSample,
        })),
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    listingsWithMedia += 1;
    mediaWritten += gallery.length;
  }

  return {
    staged: staged.length,
    mapped,
    rejected,
    rejectedByReason,
    unmatchedMedia,
    listingsWithMedia,
    listingsWithNoMedia: await countBrightListingsWithNoMedia(client),
    mediaWritten,
  };
}
