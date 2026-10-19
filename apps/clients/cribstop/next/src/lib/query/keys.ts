/**
 * Query key convention. Each domain owns one key factory and its `queryOptions` factories
 * (`lib/query/<domain>.ts`). Components and prefetch calls share them. Never write a key inline.
 * Keys start with the domain name, so `invalidateQueries({ queryKey: listingKeys.all })` works.
 */
export const listingKeys = {
  all: ['listings'] as const,
  detail: (id: string) => [...listingKeys.all, 'detail', id] as const,
};

/** Map keys (#899). Separate from `listingKeys` so other tickets can extend that one. */
export const mapKeys = {
  all: ['listings', 'map'] as const,
  /** `filters` is the serialized search filters. `bounds` is `west,south,east,north`, rounded. */
  viewport: (filters: string, bounds: string) =>
    [...mapKeys.all, 'viewport', filters, bounds] as const,
  card: (id: string) => [...mapKeys.all, 'card', id] as const,
};

/**
 * Search keys (#900). The home page and the search page read the same endpoints. A key holds the
 * endpoint and the serialized request (`requestKey`), so equal requests share one entry.
 */
export const searchKeys = {
  all: ['listings', 'search'] as const,
  results: (request: string) => [...searchKeys.all, 'results', request] as const,
  neighborhoods: (request: string) => [...searchKeys.all, 'neighborhoods', request] as const,
  zips: (request: string) => [...searchKeys.all, 'zips', request] as const,
  brokers: (request: string) => [...searchKeys.all, 'brokers', request] as const,
  meta: () => [...searchKeys.all, 'meta'] as const,
  /** The home page rows in one request (#960). */
  homeBatch: (request: string) => [...searchKeys.all, 'home-batch', request] as const,
};

/** Homes near one listing. Separate from `listingKeys` so parallel tickets do not collide. */
export const nearbyKeys = {
  forListing: (id: string) => [...listingKeys.all, 'nearby', id] as const,
};
