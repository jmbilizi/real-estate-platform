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
