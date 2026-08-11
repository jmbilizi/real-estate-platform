import { listingCardSchema, listingDetailSchema } from '@cribstop/property-contracts';
import type { ListingCardRow, ListingDetail } from '@cribstop/property-contracts';

/**
 * Contract-valid fixtures for this directory's pure unit tests. Every fixture is produced by
 * calling the contract's own `.parse()` rather than casting a hand-typed object, so a schema
 * change breaks THIS FILE loudly — a compile or a test failure here — instead of a stale fixture
 * quietly hiding a drift between what the SQL layer will one day produce and what the contract
 * actually requires.
 */

const BASE_CARD_INPUT = {
  id: '018f2f2a-6d1b-7c3d-8b2e-000000000001',
  title: 'Sample Listing (Sample)',
  address: '900 King St',
  city: 'Alexandria',
  state: 'VA',
  zip: '22314',
  neighborhood: 'Old Town',
  latitude: 38.8048,
  longitude: -77.0469,
  price: 500000,
  status: 'Active',
  listingType: 'sale',
  source: 'internal',
  propertyType: 'Single Family',
  beds: 3,
  baths: 2.5,
  sqft: 1800,
  lotSqft: 4000,
  yearBuilt: 1990,
  primaryMedia: null,
  openHouse: null,
  amenities: [],
  featured: false,
  sponsored: false,
  priceReduced: false,
  newConstruction: false,
  isSample: true,
  closePrice: null,
  closeDate: null,
  lastUpdated: '2026-08-11T00:00:00.000Z',
  listingAgentName: 'Jane Agent',
  brokerName: 'Real Broker, LLC',
  brokerPhone: '703-555-0100',
  brokerEmail: 'broker@realbroker.example',
  officeName: 'Real Broker, LLC — DC Metro',
  officeBrokerLeadPhone: '703-555-0101',
  officeBrokerLeadEmail: 'leads@realbroker.example',
  listedBy: 'Jane Agent – Real Broker, LLC — DC Metro',
} as const;

/** Builds a contract-valid `ListingCardRow`, overriding whichever fields a test needs to vary. */
export function cardFixture(overrides: Partial<typeof BASE_CARD_INPUT> = {}): ListingCardRow {
  return listingCardSchema.parse({ ...BASE_CARD_INPUT, ...overrides });
}

/**
 * A `listing_search_v` row as `pg` hands it back, for tests that exercise the mappers and the HTTP
 * layer rather than the contract. Snake-cased, and with the two driver-level representations that
 * bite in real life: `timestamptz` arrives as a `Date`, `date` arrives as the raw `YYYY-MM-DD`
 * string (see the parsers in `src/db/pool.ts`).
 *
 * Deliberately typed loosely as the mapper's own input type, so adding a column to `columns.ts`
 * without adding it here surfaces as a type error rather than a runtime `undefined`.
 */
const BASE_CARD_DB_ROW = {
  id: '018f2f2a-6d1b-7c3d-8b2e-000000000001',
  property_id: '018f2f2a-6d1b-7c3d-8b2e-000000000002',
  unit_id: null as string | null,
  title: 'Sample Listing (Sample)',
  address: '900 King St' as string | null,
  city: 'Alexandria',
  state: 'VA',
  zip: '22314',
  neighborhood: 'Old Town' as string | null,
  latitude: 38.8048 as number | null,
  longitude: -77.0469 as number | null,
  price: 500000 as number | null,
  status: 'Active',
  listing_type: 'sale',
  source: 'internal',
  property_type: 'Single Family',
  beds: 3 as number | null,
  baths: 2.5 as number | null,
  sqft: 1800 as number | null,
  lot_sqft: 4000 as number | null,
  year_built: 1990 as number | null,
  amenities: [] as string[],
  featured: false,
  featured_reason: null as string | null,
  price_reduced: false,
  new_construction: false,
  is_sample: true,
  close_price: null as number | null,
  close_date: null as string | null,
  last_updated: new Date('2026-08-11T00:00:00.000Z'),
  listing_agent_name: 'Jane Agent' as string | null,
  broker_name: 'Real Broker, LLC',
  broker_phone: '703-555-0100',
  broker_email: 'broker@realbroker.example',
  office_name: 'Real Broker, LLC — DC Metro',
  office_broker_lead_phone: '703-555-0101' as string | null,
  office_broker_lead_email: 'leads@realbroker.example' as string | null,
  listed_by: 'Jane Agent – Real Broker, LLC — DC Metro',
  open_house_starts_at: null as Date | null,
  open_house_ends_at: null as Date | null,
  open_house_remarks: null as string | null,
};

export type CardDbRowOverrides = Partial<
  typeof BASE_CARD_DB_ROW & {
    description: string | null;
    unit_number: string | null;
    unit_beds: number | null;
    unit_baths: number | null;
    unit_sqft: number | null;
    property_year_built: number | null;
    property_lot_sqft: number | null;
    primary_media_url: string | null;
    primary_media_alt_text: string | null;
    media: { url: string; alt_text: string | null }[] | null;
    open_houses: { starts_at: string; ends_at: string; remarks: string | null }[] | null;
  }
>;

export function cardDbRowFixture(
  overrides: CardDbRowOverrides = {},
): typeof BASE_CARD_DB_ROW & CardDbRowOverrides {
  return { ...BASE_CARD_DB_ROW, ...overrides };
}

const BASE_PROPERTY_INPUT = {
  id: '018f2f2a-6d1b-7c3d-8b2e-000000000002',
  propertyType: 'Condo',
  yearBuilt: 1990,
  lotSqft: null,
} as const;

const BASE_UNIT_INPUT = {
  id: '018f2f2a-6d1b-7c3d-8b2e-000000000003',
  unitNumber: '4B',
  beds: 2,
  baths: 1.5,
  sqft: 900,
} as const;

const {
  primaryMedia: _primaryMedia,
  openHouse: _openHouse,
  ...BASE_DETAIL_LISTING_INPUT
} = BASE_CARD_INPUT;

/**
 * Overrides for `detailFixture`, expressed in the flat shape a test wants to vary rather than the
 * nested `{ property, unit, listing }` object graph. `unitNumber` targets `unit.unitNumber`;
 * passing `unit: null` overrides the whole unit (the non-subdivided-home case), taking priority
 * over `unitNumber`.
 */
export interface DetailFixtureOverrides {
  readonly address?: string | null;
  readonly unitNumber?: string | null;
  readonly unit?: null;
}

export function detailFixture(overrides: DetailFixtureOverrides = {}): ListingDetail {
  const address =
    'address' in overrides ? (overrides.address ?? null) : BASE_DETAIL_LISTING_INPUT.address;
  const unit =
    'unit' in overrides && overrides.unit === null
      ? null
      : {
          ...BASE_UNIT_INPUT,
          unitNumber:
            'unitNumber' in overrides ? (overrides.unitNumber ?? null) : BASE_UNIT_INPUT.unitNumber,
        };

  return listingDetailSchema.parse({
    property: BASE_PROPERTY_INPUT,
    unit,
    listing: {
      ...BASE_DETAIL_LISTING_INPUT,
      address,
      description: null,
      media: [],
      openHouses: [],
    },
  });
}
