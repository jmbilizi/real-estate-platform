/**
 * Type-only conformance assertions against @cribstop/property-contracts.
 *
 * This file exists so that renaming, adding or removing a contract field FAILS
 * `pnpm exec nx type-check cribstop-next` instead of silently shipping a card that stopped
 * rendering an attribution field. It emits no runtime code and deliberately touches no component.
 *
 * As of #24 the rendering code *is* reconciled with this contract: `lib/types.ts` re-exports these
 * types rather than redeclaring them, so a contract change now breaks the components directly too.
 * These assertions are still worth keeping, and are not redundant with that: they pin the expected
 * key set and the `| null` branch of every nullable field by name, so a field quietly losing its
 * null branch — the drift the rendering guards exist to survive — fails here with the field named,
 * rather than silently widening what the guards are protecting against.
 */
import type {
  ListingCardRow,
  ListingDetail,
  ListingsEnvelope,
  ListingsMeta,
  Media,
  OpenHouse,
} from '@cribstop/property-contracts';

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

/**
 * Bidirectional key-set assertion. `Exclude<Expected, Actual>` is non-empty (and so fails to
 * satisfy `never`) when a key is missing from the actual type; `Exclude<Actual, Expected>` is
 * non-empty when a key was added. A rename fires both halves — the removed name in `*Missing`,
 * the new name in `*Extra` — so, unlike a single `Equals<>` union comparison, the compiler error
 * itself names the offending key instead of just collapsing to `Type 'false' does not satisfy
 * the constraint 'true'`.
 */
type AssertNever<T extends never> = T;

type ExpectedCardKeys =
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
  | 'listedBy';

export type _CardKeysMissing = AssertNever<Exclude<ExpectedCardKeys, keyof ListingCardRow>>;
export type _CardKeysExtra = AssertNever<Exclude<keyof ListingCardRow, ExpectedCardKeys>>;

type ExpectedEnvelopeKeys =
  | 'results'
  | 'total'
  | 'page'
  | 'pageSize'
  | 'pageCount'
  | 'appliedFilters';

export type _EnvelopeKeysMissing = AssertNever<
  Exclude<ExpectedEnvelopeKeys, keyof ListingsEnvelope>
>;
export type _EnvelopeKeysExtra = AssertNever<Exclude<keyof ListingsEnvelope, ExpectedEnvelopeKeys>>;

type ExpectedDetailKeys = 'property' | 'unit' | 'listing';

export type _DetailKeysMissing = AssertNever<Exclude<ExpectedDetailKeys, keyof ListingDetail>>;
export type _DetailKeysExtra = AssertNever<Exclude<keyof ListingDetail, ExpectedDetailKeys>>;

type ExpectedMetaKeys = 'dataUpdatedAt' | 'sources' | 'listingCount';

export type _MetaKeysMissing = AssertNever<Exclude<ExpectedMetaKeys, keyof ListingsMeta>>;
export type _MetaKeysExtra = AssertNever<Exclude<keyof ListingsMeta, ExpectedMetaKeys>>;

/** A land parcel legitimately has no beds/baths/sqft, and #24 must guard before formatting. */
export type _ParcelFieldsAreNullable = Expect<Equals<ListingCardRow['sqft'], number | null>>;

/** The list row must never carry description — it is detail-only. */
export type _NoDescriptionOnCard = Expect<
  Equals<'description' extends keyof ListingCardRow ? true : false, false>
>;

/**
 * Every other explicitly nullable card field (PRD §6.3) must keep its null branch. A `keyof`
 * assertion never sees value types, so a field quietly losing its `| null` — exactly the drift
 * #24's rendering guards must survive — would pass `_CardKeysMissing`/`_CardKeysExtra` silently.
 * One assertion per field so a failure names the field via the export/line it breaks.
 */
export type _AddressIsNullable = Expect<Equals<ListingCardRow['address'], string | null>>;
export type _NeighborhoodIsNullable = Expect<Equals<ListingCardRow['neighborhood'], string | null>>;
export type _LatitudeIsNullable = Expect<Equals<ListingCardRow['latitude'], number | null>>;
export type _LongitudeIsNullable = Expect<Equals<ListingCardRow['longitude'], number | null>>;
export type _PriceIsNullable = Expect<Equals<ListingCardRow['price'], number | null>>;
export type _BedsIsNullable = Expect<Equals<ListingCardRow['beds'], number | null>>;
export type _BathsIsNullable = Expect<Equals<ListingCardRow['baths'], number | null>>;
export type _LotSqftIsNullable = Expect<Equals<ListingCardRow['lotSqft'], number | null>>;
export type _YearBuiltIsNullable = Expect<Equals<ListingCardRow['yearBuilt'], number | null>>;
export type _PrimaryMediaIsNullable = Expect<Equals<ListingCardRow['primaryMedia'], Media | null>>;
export type _OpenHouseIsNullable = Expect<Equals<ListingCardRow['openHouse'], OpenHouse | null>>;
export type _ClosePriceIsNullable = Expect<Equals<ListingCardRow['closePrice'], number | null>>;
export type _CloseDateIsNullable = Expect<Equals<ListingCardRow['closeDate'], string | null>>;
export type _ListingAgentNameIsNullable = Expect<
  Equals<ListingCardRow['listingAgentName'], string | null>
>;
export type _OfficeBrokerLeadPhoneIsNullable = Expect<
  Equals<ListingCardRow['officeBrokerLeadPhone'], string | null>
>;
export type _OfficeBrokerLeadEmailIsNullable = Expect<
  Equals<ListingCardRow['officeBrokerLeadEmail'], string | null>
>;
