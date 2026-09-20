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
  getOrCreateProperty,
  getOrCreateUnit,
  Queryable,
  upsertListingBySourceKey,
} from '../../db/write';
import { PropertyRow, UnitRow } from '../../seed/types';
import { randomUUID } from 'node:crypto';

import { mapBrightPropertyRecord } from './map-record';
import { BrightMapRunReport, ZERO_MAP_REPORT } from './report';
import { BrightFeedTier } from './sample';
import { ListingStatusLookup } from './status';

const SOURCE_SYSTEM = 'BrightMLS';
const RESOURCE = 'BrightProperties';

export interface MapStagedBrightPropertiesOptions {
  readonly feed: BrightFeedTier;
  /** Configured licensed display-delay window for solds, in days. `null` = unconfigured, fail closed. */
  readonly soldDisplayDelayDays: number | null;
}

/** Reads the current vocabulary, so an added `listing_statuses` row needs no code change here. */
export async function loadListingStatuses(client: Queryable): Promise<ListingStatusLookup[]> {
  const { rows } = await client.query(
    // ORDER BY sort_order: two codes ('Hold' and 'Temporarily Off Market') share the same
    // reso_standard_status ('Hold'). mapStandardStatus() takes the first array match, so the order
    // here — not incidental — decides which code an ambiguous Bright value resolves to.
    'SELECT code, consumer_status, is_terminal, reso_standard_status FROM listing_statuses ORDER BY sort_order',
  );
  return rows.map((row) => ({
    code: String(row.code),
    consumerStatus: (row.consumer_status ?? null) as ListingStatusLookup['consumerStatus'],
    isTerminal: Boolean(row.is_terminal),
    resoStandardStatus: (row.reso_standard_status ?? null) as string | null,
  }));
}

interface StagedRow {
  readonly record_key: string;
  readonly payload: unknown;
}

async function loadStagedRecords(client: Queryable): Promise<StagedRow[]> {
  const { rows } = await client.query(
    'SELECT record_key, payload FROM bright_staging_records WHERE resource = $1',
    [RESOURCE],
  );
  return rows as unknown as StagedRow[];
}

export async function mapStagedBrightProperties(
  client: Queryable,
  options: MapStagedBrightPropertiesOptions,
): Promise<BrightMapRunReport> {
  const staged = await loadStagedRecords(client);
  if (staged.length === 0) {
    return ZERO_MAP_REPORT;
  }

  const statuses = await loadListingStatuses(client);
  const withheldByReason: Record<string, number> = {};
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

    const propertyRow: PropertyRow = { id: randomUUID(), community_id: null, ...result.property };
    const propertyId = await getOrCreateProperty(client, propertyRow);

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
    await upsertListingBySourceKey(client, {
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

    if (listing.isSample) {
      sampleMarked += 1;
    }
    if (listing.consumerStatus === null) {
      takenDown += 1;
    } else if (listing.suppression.internetDisplayAllowed) {
      published += 1;
    }
  }

  const withheld = Object.values(withheldByReason).reduce((total, count) => total + count, 0);

  return {
    staged: staged.length,
    mapped,
    published,
    withheld,
    withheldByReason,
    takenDown,
    sampleMarked,
  };
}
