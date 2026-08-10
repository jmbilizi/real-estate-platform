/**
 * Type-only conformance assertions against @cribstop/listing-contracts.
 *
 * This file exists so that renaming, adding or removing a contract field FAILS
 * `pnpm exec nx type-check cribstop-next` instead of silently shipping a card that stopped
 * rendering an attribution field. It emits no runtime code and deliberately touches no component —
 * reconciling the rendering code with this contract is #24.
 */
import type {
  ListingCardRow,
  ListingDetail,
  ListingsEnvelope,
  ListingsMeta,
} from '@cribstop/listing-contracts';

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

export type _CardKeys = Expect<
  Equals<
    keyof ListingCardRow,
    | 'id'
    | 'title'
    | 'address'
    | 'city'
    | 'state'
    | 'zip'
    | 'neighborhood'
    | 'latitude'
    | 'longitude'
    | 'price'
    | 'status'
    | 'listingType'
    | 'source'
    | 'propertyType'
    | 'beds'
    | 'baths'
    | 'sqft'
    | 'lotSqft'
    | 'yearBuilt'
    | 'primaryMedia'
    | 'openHouse'
    | 'amenities'
    | 'featured'
    | 'sponsored'
    | 'priceReduced'
    | 'newConstruction'
    | 'isSample'
    | 'closePrice'
    | 'closeDate'
    | 'lastUpdated'
    | 'listingAgentName'
    | 'brokerName'
    | 'brokerPhone'
    | 'brokerEmail'
    | 'officeName'
    | 'officeBrokerLeadPhone'
    | 'officeBrokerLeadEmail'
    | 'listedBy'
  >
>;

export type _EnvelopeKeys = Expect<
  Equals<
    keyof ListingsEnvelope,
    'results' | 'total' | 'page' | 'pageSize' | 'pageCount' | 'appliedFilters'
  >
>;

export type _DetailKeys = Expect<Equals<keyof ListingDetail, 'property' | 'unit' | 'listing'>>;

export type _MetaKeys = Expect<
  Equals<keyof ListingsMeta, 'dataUpdatedAt' | 'sources' | 'listingCount'>
>;

/** A land parcel legitimately has no beds/baths/sqft, and #24 must guard before formatting. */
export type _ParcelFieldsAreNullable = Expect<Equals<ListingCardRow['sqft'], number | null>>;

/** The list row must never carry description — it is detail-only. */
export type _NoDescriptionOnCard = Expect<
  Equals<'description' extends keyof ListingCardRow ? true : false, false>
>;
