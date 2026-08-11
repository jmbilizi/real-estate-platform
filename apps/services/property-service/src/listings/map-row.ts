import {
  type ListingCardRow,
  listingCardSchema,
  type ListingDetail,
  listingDetailSchema,
  type ListingsMeta,
  listingsMetaSchema,
} from '@cribstop/property-contracts';

/**
 * Database row -> wire shape. Every mapper ends in the contract's own `.parse()`, deliberately.
 *
 * The alternative — trusting the SQL and casting — makes a drift between a column name and a schema
 * field a silently malformed payload: an attribution key that quietly stops being sent is exactly the
 * failure `libs/property-contracts` exists to prevent, and it is invisible to a type assertion because
 * `unknown as ListingCardRow` asserts nothing at runtime. Parsing costs microseconds and converts that
 * class of bug into a loud 500 in a test run instead of a compliance gap in production.
 */

/** The shape `pg` hands back for the enumerated card projection (see `columns.ts`). */
export interface ListingCardDbRow {
  id: string;
  property_id: string;
  unit_id: string | null;
  title: string;
  address: string | null;
  city: string;
  state: string;
  zip: string;
  neighborhood: string | null;
  latitude: number | null;
  longitude: number | null;
  price: number | null;
  status: string;
  listing_type: string;
  source: string;
  property_type: string;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  lot_sqft: number | null;
  year_built: number | null;
  amenities: string[];
  featured: boolean;
  featured_reason: string | null;
  price_reduced: boolean;
  new_construction: boolean;
  is_sample: boolean;
  close_price: number | null;
  close_date: string | null;
  last_updated: Date;
  listing_agent_name: string | null;
  broker_name: string;
  broker_phone: string;
  broker_email: string;
  office_name: string;
  office_broker_lead_phone: string | null;
  office_broker_lead_email: string | null;
  listed_by: string;
  open_house_starts_at: Date | null;
  open_house_ends_at: Date | null;
  open_house_remarks: string | null;
  /** Detail projection only. */
  description?: string | null;
  /** Joined aggregates, detail projection only. */
  media?: { url: string; alt_text: string | null }[] | null;
  open_houses?: { starts_at: string; ends_at: string; remarks: string | null }[] | null;
  primary_media_url?: string | null;
  primary_media_alt_text?: string | null;
  /** Durable property facts, detail projection only. */
  property_year_built?: number | null;
  property_lot_sqft?: number | null;
  /** Durable unit facts, detail projection only. Null `unit_id` means there is no unit at all. */
  unit_number?: string | null;
  unit_beds?: number | null;
  unit_baths?: number | null;
  unit_sqft?: number | null;
}

/**
 * `timestamptz` arrives as a `Date`; the contract publishes an ISO instant string. `date` arrives as
 * the raw `YYYY-MM-DD` string thanks to the parser in `src/db/pool.ts`, so `close_date` needs no
 * conversion here — converting it would reintroduce the timezone that parser exists to remove.
 */
const instant = (value: Date): string => value.toISOString();

/**
 * The soonest upcoming occurrence, collapsed from the view's three columns. They are null together by
 * construction (one `LEFT JOIN LATERAL`), so a partial row means the projection changed and the
 * contract parse below should be the thing that complains.
 */
function openHouseOf(row: ListingCardDbRow): unknown {
  if (row.open_house_starts_at === null || row.open_house_ends_at === null) {
    return null;
  }
  return {
    startsAt: instant(row.open_house_starts_at),
    endsAt: instant(row.open_house_ends_at),
    remarks: row.open_house_remarks,
  };
}

/**
 * The fields common to the card and the detail's `listing` block. `sponsored` is the one derived
 * value: it is `featured_reason = 'paid'` and nothing else. `recommended` ranks `featured` first, so a
 * paid placement ranked first with no label is an FTC / PRD §6 disclosure failure — deriving it here
 * from the recorded reason is what makes the label renderable from data rather than from a guess.
 */
function commonFields(row: ListingCardDbRow): Record<string, unknown> {
  return {
    id: row.id,
    title: row.title,
    address: row.address,
    city: row.city,
    state: row.state,
    zip: row.zip,
    neighborhood: row.neighborhood,
    latitude: row.latitude,
    longitude: row.longitude,
    price: row.price,
    status: row.status,
    listingType: row.listing_type,
    source: row.source,
    propertyType: row.property_type,
    beds: row.beds,
    baths: row.baths,
    sqft: row.sqft,
    lotSqft: row.lot_sqft,
    yearBuilt: row.year_built,
    amenities: row.amenities,
    featured: row.featured,
    sponsored: row.featured_reason === 'paid',
    priceReduced: row.price_reduced,
    newConstruction: row.new_construction,
    isSample: row.is_sample,
    closePrice: row.close_price,
    closeDate: row.close_date,
    lastUpdated: instant(row.last_updated),
    listingAgentName: row.listing_agent_name,
    brokerName: row.broker_name,
    brokerPhone: row.broker_phone,
    brokerEmail: row.broker_email,
    officeName: row.office_name,
    officeBrokerLeadPhone: row.office_broker_lead_phone,
    officeBrokerLeadEmail: row.office_broker_lead_email,
    listedBy: row.listed_by,
  };
}

export function toListingCardRow(row: ListingCardDbRow): ListingCardRow {
  return listingCardSchema.parse({
    ...commonFields(row),
    primaryMedia:
      row.primary_media_url == null
        ? null
        : { url: row.primary_media_url, altText: row.primary_media_alt_text ?? null },
    openHouse: openHouseOf(row),
  });
}

/**
 * The object graph. `unit` is null when the offer is on the whole property — a single-family home has
 * zero unit rows by design, so this is meaningful rather than missing, and no unit object is
 * synthesised for it.
 *
 * `property.yearBuilt`/`lotSqft` come from the durable property row, NOT from the listing snapshot:
 * they may legitimately differ, because the listing's copy is frozen at what was advertised while the
 * property's is current. Display-suppressed values are never re-sourced from here.
 */
export function toListingDetail(row: ListingCardDbRow): ListingDetail {
  return listingDetailSchema.parse({
    property: {
      id: row.property_id,
      propertyType: row.property_type,
      yearBuilt: row.property_year_built ?? null,
      lotSqft: row.property_lot_sqft ?? null,
    },
    unit:
      row.unit_id === null
        ? null
        : {
            id: row.unit_id,
            unitNumber: row.unit_number ?? null,
            beds: row.unit_beds ?? null,
            baths: row.unit_baths ?? null,
            sqft: row.unit_sqft ?? null,
          },
    listing: {
      ...commonFields(row),
      description: row.description ?? null,
      media: (row.media ?? []).map((item) => ({ url: item.url, altText: item.alt_text })),
      openHouses: (row.open_houses ?? []).map((item) => ({
        startsAt: item.starts_at,
        endsAt: item.ends_at,
        remarks: item.remarks,
      })),
    },
  });
}

export interface ListingsMetaDbRow {
  data_updated_at: Date | null;
  sources: string[] | null;
  listing_count: number;
}

/**
 * `null` for `dataUpdatedAt` is a required state, not an error: with no publishable listings we do not
 * know when the data was last refreshed, and rendering "now" would be a fabricated fact (PRD §6.3).
 * `array_agg(DISTINCT ...)` over zero rows returns SQL NULL rather than an empty array, hence the
 * `?? []` — an empty list is the honest answer there, because "no sources present" is a fact we do
 * know.
 */
export function toListingsMeta(row: ListingsMetaDbRow): ListingsMeta {
  return listingsMetaSchema.parse({
    dataUpdatedAt: row.data_updated_at === null ? null : instant(row.data_updated_at),
    sources: row.sources ?? [],
    listingCount: row.listing_count,
  });
}
