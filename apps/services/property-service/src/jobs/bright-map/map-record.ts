/**
 * Pure mapping of one staged `BrightProperty` payload into consumer-schema row shapes (#93).
 *
 * This module never touches a database. It decides, from the raw feed record alone, whether the
 * record is publishable and — if so — what to write. `run.ts` in this directory is the impure half:
 * it reads `bright_staging_records`, calls this function, and pushes the result through
 * `src/db/write.ts`, the only module allowed to write `properties`/`units`/`listings`.
 *
 * Every rejection reason is a distinct fail-closed path required by #93's acceptance criteria:
 * an unrecognised status, missing attribution, or an address/price/property-type the record does not
 * carry. None of these guess — a record this function cannot confidently map does not publish.
 */

import { buildAddressKey, splitUnitDesignator } from '../../seed/address';
import { PropertyType } from '../../seed/constants';
import { ListingStatus } from '../../seed/constants';
import { OfferKind } from '../../seed/types';

import { AttributionFields, mapAttribution } from './attribution';
import { mapPropertyType } from './property-type';
import { BrightFeedTier, isSampleFeed, withSampleSuffix } from './sample';
import { ListingStatusLookup, mapStandardStatus } from './status';
import { mapSuppressionFlags, SuppressionFlags } from './suppression';

export type RejectReason =
  | 'missing_listing_key'
  | 'missing_address'
  | 'missing_price'
  | 'unrecognized_property_type'
  | 'unrecognized_status'
  | 'sold_display_delay_not_configured'
  | 'sold_missing_close_date'
  | 'sold_still_in_display_delay_window'
  | 'missing_required_attribution';

export interface MappedPropertyInput {
  readonly address_raw: string;
  readonly street_line: string;
  readonly city: string;
  readonly state: string;
  readonly zip5: string;
  readonly address_key: string;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly neighborhood: string | null;
  readonly property_type: PropertyType;
  readonly year_built: number | null;
  readonly lot_sqft: number | null;
  readonly beds: number | null;
  readonly baths_full: number | null;
  readonly baths_half: number | null;
  readonly living_sqft: number | null;
  readonly is_sample: boolean;
}

export interface MappedListingInput {
  readonly title: string;
  readonly offerKind: OfferKind;
  readonly status: string;
  readonly consumerStatus: ListingStatus | null;
  readonly listPrice: number;
  readonly closePrice: number | null;
  readonly closeDate: string | null;
  readonly description: string | null;
  readonly attribution: AttributionFields;
  readonly suppression: SuppressionFlags;
  readonly isSample: boolean;
  readonly lastUpdated: string;
}

export interface MappedRecord {
  readonly kind: 'mapped';
  readonly listingKey: string;
  readonly unitNumber: string | null;
  readonly property: MappedPropertyInput;
  readonly listing: MappedListingInput;
}

export interface RejectedRecord {
  readonly kind: 'rejected';
  readonly listingKey: string | null;
  readonly reason: RejectReason;
}

export type MapResult = MappedRecord | RejectedRecord;

export interface MapContext {
  readonly feed: BrightFeedTier;
  readonly statuses: readonly ListingStatusLookup[];
  /** Configured display-delay window for solds, in days. `null` means unconfigured — fail closed. */
  readonly soldDisplayDelayDays: number | null;
}

function nonBlank(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * `ListingKey` (and other Bright identifier fields) round-trip through Postgres `jsonb` as a JSON
 * number when the source value looks numeric, even though RESO types it `Edm.String`. Identity
 * fields are not free text, so widening to accept a number here carries none of the fail-closed
 * risk `nonBlank` guards against elsewhere in this module.
 */
function keyString(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return nonBlank(value);
}

function toNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * `properties.lot_sqft` is `integer`, but Bright's `LotSizeSquareFeet` is `Edm.Double` (#207) — a lot
 * converted from acres routinely carries a fractional value (e.g. `127195.2`). Postgres rejects that
 * text verbatim against an integer column, which crashed the whole mapping pass rather than
 * rejecting the one record: an uncaught error, not a `RejectReason`. Rounding to the nearest square
 * foot loses nothing a consumer would notice and keeps the column's existing type.
 */
function toRoundedNumber(value: unknown): number | null {
  const n = toNumber(value);
  return n === null ? null : Math.round(n);
}

function toDateOnly(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  // Bright sends dates as `YYYY-MM-DD`; only the date part is kept if a timestamp slips through.
  return value.slice(0, 10);
}

function reject(listingKey: string | null, reason: RejectReason): RejectedRecord {
  return { kind: 'rejected', listingKey, reason };
}

/**
 * Bright's `PropertyType` carries the sale/lease split as a suffix on the value itself — observed on
 * the wire as `Residential Lease` and `CommercialLease` (Bright is inconsistent about the space). A
 * lease record maps to `offer_kind: 'rent'` (#225); Homes is scoped as buy/sell/rent (PRD line 229).
 *
 * A closed set of observed values, not a `.includes('Lease')` substring test: RESO also uses "Lease"
 * inside non-rental descriptors (e.g. a ground-lease land tenure), and a substring match would
 * misclassify a genuine sale on a word that does not actually mean "this is a rental".
 */
const LEASE_PROPERTY_TYPES = new Set(['Residential Lease', 'CommercialLease']);

function isLeaseOffer(payload: Readonly<Record<string, unknown>>): boolean {
  const propertyType = nonBlank(payload.PropertyType);
  return propertyType !== null && LEASE_PROPERTY_TYPES.has(propertyType);
}

export function mapBrightPropertyRecord(
  payload: Readonly<Record<string, unknown>>,
  ctx: MapContext,
): MapResult {
  const listingKey = keyString(payload.ListingKey);
  if (!listingKey) {
    return reject(null, 'missing_listing_key');
  }

  const unparsedAddress = nonBlank(payload.UnparsedAddress);
  const city = nonBlank(payload.City);
  const state = nonBlank(payload.StateOrProvince);
  const zip = nonBlank(payload.PostalCode);
  if (!unparsedAddress || !city || !state || !zip) {
    return reject(listingKey, 'missing_address');
  }

  const listPrice = toNumber(payload.ListPrice);
  if (listPrice === null) {
    return reject(listingKey, 'missing_price');
  }

  const offerKind: OfferKind = isLeaseOffer(payload) ? 'rent' : 'sale';

  const propertyType = mapPropertyType(payload);
  if (!propertyType) {
    return reject(listingKey, 'unrecognized_property_type');
  }

  const statusMap = mapStandardStatus(nonBlank(payload.StandardStatus), ctx.statuses);
  if (!statusMap) {
    return reject(listingKey, 'unrecognized_status');
  }

  const closeDate = toDateOnly(payload.CloseDate);
  if (statusMap.consumerStatus === 'Sold') {
    // #33: the licensed display-delay window for solds is not yet confirmed. An unconfigured window
    // fails closed rather than publishing a sold with no delay at all.
    if (ctx.soldDisplayDelayDays === null) {
      return reject(listingKey, 'sold_display_delay_not_configured');
    }
    const closedAt = closeDate ? new Date(`${closeDate}T00:00:00Z`).getTime() : NaN;
    // A malformed CloseDate (or none at all) parses to NaN, and every comparison against NaN is
    // false — including `Date.now() < NaN`, which would otherwise fall through as "not still in
    // the delay window" and publish an undated sold with zero delay. Reject explicitly instead of
    // relying on the comparison to fail safe.
    if (!closeDate || Number.isNaN(closedAt)) {
      return reject(listingKey, 'sold_missing_close_date');
    }
    const delayMs = ctx.soldDisplayDelayDays * 24 * 60 * 60 * 1000;
    if (Date.now() < closedAt + delayMs) {
      return reject(listingKey, 'sold_still_in_display_delay_window');
    }
  }

  const attribution = mapAttribution(payload);
  if (!attribution.ok) {
    return reject(listingKey, attribution.reason);
  }

  const { streetLine, unitNumber } = splitUnitDesignator(unparsedAddress);
  const addressKey = buildAddressKey({ streetLine, state, zip5: zip });
  const isSample = isSampleFeed(ctx.feed);
  const baseTitle = `${propertyType} in ${city}, ${state}`;
  const title = isSample ? withSampleSuffix(baseTitle) : baseTitle;

  const suppression = mapSuppressionFlags(payload);

  const lastUpdated = nonBlank(payload.ModificationTimestamp) ?? new Date().toISOString();

  return {
    kind: 'mapped',
    listingKey,
    unitNumber,
    property: {
      address_raw: unparsedAddress,
      street_line: streetLine,
      city,
      state,
      zip5: zip,
      address_key: addressKey,
      latitude: toNumber(payload.Latitude),
      longitude: toNumber(payload.Longitude),
      neighborhood: nonBlank(payload.SubdivisionName),
      property_type: propertyType,
      year_built: toNumber(payload.YearBuilt),
      lot_sqft: toRoundedNumber(payload.LotSizeSquareFeet),
      beds: toNumber(payload.BedroomsTotal),
      baths_full: toNumber(payload.BathroomsFull),
      baths_half: toNumber(payload.BathroomsHalf),
      living_sqft: toNumber(payload.LivingArea),
      is_sample: isSample,
    },
    listing: {
      title,
      offerKind,
      status: statusMap.code,
      consumerStatus: statusMap.consumerStatus,
      listPrice,
      closePrice: toNumber(payload.ClosePrice),
      closeDate,
      description: nonBlank(payload.PublicRemarks),
      attribution: attribution.fields,
      suppression,
      isSample,
      lastUpdated,
    },
  };
}
