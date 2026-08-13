/**
 * Client-side listing types.
 *
 * These are re-exports of `@cribstop/property-contracts`, not a second declaration of the same
 * shapes. The hand-rolled `Listing` interface that used to live here described the mock array, and
 * it disagreed with the wire contract in ways that mattered: it declared `beds`, `baths` and `sqft`
 * required (they are legitimately null for a parcel), it carried `imageUrls` (a field the contract
 * structurally forbids), it spelled the office lead email `officeBrokerLeadMail`, and it had no
 * `isSample`, `sponsored`, `closePrice` or `closeDate` at all — so three compliance obligations had
 * no way to reach the UI.
 *
 * Search and detail are two different shapes from one service: `ListingCardRow` is the flat card
 * projection the list endpoint returns, and `ListingDetailView` (in `lib/api/listings.ts`) is the
 * flattened form of the nested detail graph. Neither is forced to serve both.
 */
import type { ListingCardRow, SearchRequest } from '@cribstop/property-contracts';

export type {
  Amenity,
  Attribution,
  ListingCardRow,
  ListingDetail,
  ListingsEnvelope,
  ListingsMeta,
  ListingSource,
  ListingType,
  Media,
  OpenHouse,
  PropertyType,
  SearchRequest,
} from '@cribstop/property-contracts';

/** The consumer-visible statuses a row can carry, taken from the contract. */
export type ListingStatus = ListingCardRow['status'];

/** Sort options, taken from the contract so the dropdown cannot offer one the API rejects. */
export type ListingSort = SearchRequest['sort'];

/**
 * The filter set the search UI holds and puts in the URL.
 *
 * Derived from the contract's parsed request type, which is what keeps the UI and the API from
 * drifting — and is why no occupancy field can be added here (#34): the contract has none, so this
 * type cannot express one.
 */
export type SearchFilters = Partial<SearchRequest>;
