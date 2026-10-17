/**
 * Query key convention. Each domain owns one key factory and its `queryOptions` factories
 * (`lib/query/<domain>.ts`). Components and prefetch calls share them. Never write a key inline.
 * Keys start with the domain name, so `invalidateQueries({ queryKey: listingKeys.all })` works.
 */
export const listingKeys = {
  all: ['listings'] as const,
  detail: (id: string) => [...listingKeys.all, 'detail', id] as const,
};
