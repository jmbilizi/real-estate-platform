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
