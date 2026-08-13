import type {
  ErrorBody,
  ListingDetail,
  ListingsEnvelope,
  ListingsMeta,
  Media,
  OpenHouse,
  SearchRequest,
} from '@cribstop/property-contracts';

/**
 * Client for the Property API's `listings` resource, following the `lib/api/account.ts` pattern:
 * the browser calls this app's own route handlers under `/api/*`, which make the gateway hop
 * server-side. Nothing here knows the gateway's address.
 *
 * The module is named for the **resource** it wraps (`listings`), while the service, its published
 * document and its gateway namespace are named for the **domain** (`property-service`,
 * `Property Service`, `/property/*`). Neither renames the other (#62).
 */

/**
 * A search query, derived from the contract's own parsed request type rather than hand-declared.
 *
 * Deriving it is what makes the occupancy rule (#34) structural on this side too: the contract has
 * no occupancy field, so `ListingSearchQuery` cannot express one, and a caller that tries to pass
 * an age band or a pets count fails to compile rather than reaching a query string.
 */
export type ListingSearchQuery = Partial<SearchRequest>;

/** Thrown for any non-2xx response, carrying the contract's error code so callers can branch. */
export class ListingsApiError extends Error {
  constructor(
    message: string,
    readonly code: ErrorBody['error']['code'],
    readonly status: number,
  ) {
    super(message);
    this.name = 'ListingsApiError';
  }

  /**
   * "This listing is not available" — not a failure the user should retry.
   *
   * Requires **both** the 404 status and the contract's `not_found` code, deliberately. A gateway
   * route miss also returns 404, but with no contract body, so the proxy labels it
   * `internal_error`; treating status alone as "not found" made a misrouted gateway look like a
   * withdrawn listing, and made the favorites page skip every saved home and render "No saved homes
   * yet" instead of an error the user could act on. Silently emptying someone's saved list on an
   * infrastructure fault is the worst available outcome. The service's only listing-level 404 always
   * carries `code: 'not_found'`, so nothing legitimate is lost by requiring both.
   */
  get isNotFound(): boolean {
    return this.status === 404 && this.code === 'not_found';
  }
}

const USER_FACING_MESSAGE: Record<ErrorBody['error']['code'], string> = {
  invalid_request: 'We could not run that search. Try adjusting your filters.',
  not_found: 'This listing is no longer available.',
  internal_error: 'We could not load listings just now. Please try again.',
};

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { signal, headers: { Accept: 'application/json' } });
  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const code: ErrorBody['error']['code'] =
      body && typeof body === 'object' && body.error?.code ? body.error.code : 'internal_error';
    throw new ListingsApiError(
      USER_FACING_MESSAGE[code] ?? USER_FACING_MESSAGE.internal_error,
      code,
      res.status,
    );
  }

  if (body === null) {
    throw new ListingsApiError(USER_FACING_MESSAGE.internal_error, 'internal_error', res.status);
  }

  return body as T;
}

/** Serializes a typed query. Booleans and numbers become the string forms the contract parses. */
export function toSearchParams(query: ListingSearchQuery): URLSearchParams {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;

    if (Array.isArray(value)) {
      for (const entry of value) params.append(key, String(entry));
    } else if (typeof value === 'boolean') {
      params.set(key, value ? 'true' : 'false');
    } else {
      params.set(key, String(value));
    }
  }

  return params;
}

export async function searchListings(
  query: ListingSearchQuery = {},
  signal?: AbortSignal,
): Promise<ListingsEnvelope> {
  const params = toSearchParams(query).toString();
  return getJson<ListingsEnvelope>(`/api/listings${params ? `?${params}` : ''}`, signal);
}

export async function getListingsMeta(signal?: AbortSignal): Promise<ListingsMeta> {
  return getJson<ListingsMeta>('/api/listings/meta', signal);
}

// ---------------------------------------------------------------------------------------------
// Detail mapping layer
// ---------------------------------------------------------------------------------------------

/**
 * The flat view model the detail UI renders.
 *
 * Search and detail are **two different shapes** from one service — list rows are a flat card
 * projection, detail is a nested `{ property, unit, listing }` graph — so this is an explicit
 * mapping rather than a spread of the nested object into a card type.
 */
export interface ListingDetailView {
  // --- identity of the offer's subject -------------------------------------------------------
  /** The listing's own id — what the URL and the save/favourite state key on. */
  id: string;
  propertyId: string;
  /** The unit's id for a subdivided building, otherwise the property's — `unit ?? property`. */
  subjectId: string;
  /** Null when the offer is the whole property rather than a unit within a subdivided building. */
  unitId: string | null;
  /** Null for a non-subdivided home, and also nulled whenever the address was masked. */
  unitNumber: string | null;
  /** True only for a genuinely subdivided building. `false` is meaningful, never "unknown". */
  isSubdivided: boolean;
  /** A parcel has no dwelling to describe, so the detail page suppresses the stat block. */
  isParcel: boolean;

  // --- everything the card carries, plus the detail-only fields ------------------------------
  title: string;
  address: string | null;
  city: string;
  state: string;
  zip: string;
  neighborhood: string | null;
  latitude: number | null;
  longitude: number | null;
  price: number | null;
  status: ListingDetail['listing']['status'];
  listingType: ListingDetail['listing']['listingType'];
  source: ListingDetail['listing']['source'];
  propertyType: ListingDetail['listing']['propertyType'];
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  lotSqft: number | null;
  yearBuilt: number | null;
  amenities: ListingDetail['listing']['amenities'];
  featured: boolean;
  sponsored: boolean;
  priceReduced: boolean;
  newConstruction: boolean;
  isSample: boolean;
  closePrice: number | null;
  closeDate: string | null;
  lastUpdated: string;
  description: string | null;
  media: Media[];
  openHouses: OpenHouse[];

  // --- NAR 7.58 attribution ------------------------------------------------------------------
  listingAgentName: string | null;
  brokerName: string;
  brokerPhone: string;
  brokerEmail: string;
  officeName: string;
  officeBrokerLeadPhone: string | null;
  officeBrokerLeadEmail: string | null;
  /** Derived server-side. Rendered as-is — never reassembled here, or it could disagree. */
  listedBy: string;
}

/**
 * Flattens the detail graph.
 *
 * `unit === null` means a non-subdivided home — a single-family house has zero unit rows *by
 * design*. It is never an error and never a loading state, and resolution is exactly one level
 * (`unit ?? property`), never a chain.
 *
 * Displayed values come from `listing`, which is the advertised snapshot and the shape that
 * carries seller display-suppression (a masked address, a withheld price). `property` and `unit`
 * are the current durable site facts, and the contract is explicit that display-suppressed values
 * are **not** re-sourced from them — doing so would hand back precisely the field the seller
 * withheld. They are therefore used for the subject's identity only.
 */
export function toListingDetailView(detail: ListingDetail): ListingDetailView {
  const { property, unit, listing } = detail;

  // Exactly one level: the subject of the offer is the unit when the building is subdivided,
  // otherwise the property itself. Nothing below reaches past this resolution.
  const subject: { id: string } = unit ?? property;

  return {
    id: listing.id,
    propertyId: property.id,
    subjectId: subject.id,
    unitId: unit ? unit.id : null,
    unitNumber: unit ? unit.unitNumber : null,
    isSubdivided: unit !== null,
    /*
     * From the advertised snapshot, not the durable site record, because this gates a *display*
     * decision (suppressing the dwelling stat block) and every other displayed value on this view
     * comes from `listing`. Sourcing it from `property` meant a re-classified property could show
     * "Single Family" while hiding the bed/bath/sqft block, and could disagree with its own card,
     * which reads the snapshot.
     */
    isParcel: listing.propertyType === 'Land',

    title: listing.title,
    address: listing.address,
    city: listing.city,
    state: listing.state,
    zip: listing.zip,
    neighborhood: listing.neighborhood,
    latitude: listing.latitude,
    longitude: listing.longitude,
    price: listing.price,
    status: listing.status,
    listingType: listing.listingType,
    source: listing.source,
    propertyType: listing.propertyType,
    beds: listing.beds,
    baths: listing.baths,
    sqft: listing.sqft,
    lotSqft: listing.lotSqft,
    yearBuilt: listing.yearBuilt,
    amenities: listing.amenities,
    featured: listing.featured,
    sponsored: listing.sponsored,
    priceReduced: listing.priceReduced,
    newConstruction: listing.newConstruction,
    isSample: listing.isSample,
    closePrice: listing.closePrice,
    closeDate: listing.closeDate,
    lastUpdated: listing.lastUpdated,
    description: listing.description,
    media: listing.media,
    openHouses: listing.openHouses,

    listingAgentName: listing.listingAgentName,
    brokerName: listing.brokerName,
    brokerPhone: listing.brokerPhone,
    brokerEmail: listing.brokerEmail,
    officeName: listing.officeName,
    officeBrokerLeadPhone: listing.officeBrokerLeadPhone,
    officeBrokerLeadEmail: listing.officeBrokerLeadEmail,
    listedBy: listing.listedBy,
  };
}

export async function getListing(id: string, signal?: AbortSignal): Promise<ListingDetailView> {
  return toListingDetailView(
    await getJson<ListingDetail>(`/api/listings/${encodeURIComponent(id)}`, signal),
  );
}
