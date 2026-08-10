import { z } from 'zod';
import { amenitySchema, listingTypeSchema, propertyTypeSchema } from './common';

/** Preserves the client's existing paging arithmetic in
 *  `apps/clients/cribstop/next/src/app/(with-search)/search/page.tsx`. */
export const PAGE_SIZE_DEFAULT = 20;
export const PAGE_SIZE_MAX = 100;

const queryInt = z.string().regex(/^\d+$/, 'must be a whole number').transform(Number);

const queryBoolean = z.enum(['true', 'false']).transform((value) => value === 'true');

/** Repeated param (`?amenities=Pool&amenities=Garage`) or comma list (`?amenities=Pool,Garage`). */
const amenityList = z
  .union([z.string(), z.array(z.string())])
  .transform((value) =>
    (Array.isArray(value) ? value : value.split(',')).map((entry) => entry.trim()).filter(Boolean),
  )
  .pipe(z.array(amenitySchema));

/**
 * Strict on purpose. An unknown parameter is rejected rather than ignored, which kills the
 * silent-typo'd-filter bug (`?bed=3` quietly returning unfiltered results) and, more importantly,
 * leaves no room for a future field-selection parameter that could strip attribution.
 */
export const searchRequestSchema = z.strictObject({
  query: z.string().optional(),
  zip: z.string().optional(),
  street: z.string().optional(),
  listingType: z.union([listingTypeSchema, z.literal('all')]).default('all'),
  propertyType: z.union([propertyTypeSchema, z.literal('all')]).default('all'),
  minPrice: queryInt.optional(),
  maxPrice: queryInt.optional(),
  beds: queryInt.optional(),
  baths: queryInt.optional(),
  minSqft: queryInt.optional(),
  neighborhood: z.string().optional(),
  openHouse: queryBoolean.optional(),
  newConstruction: queryBoolean.optional(),
  waterfront: queryBoolean.optional(),
  petFriendly: queryBoolean.optional(),
  amenities: amenityList.optional(),
  sort: z.enum(['recommended', 'newest', 'price-asc', 'price-desc']).default('recommended'),
  page: queryInt.pipe(z.number().int().min(1)).default(1),
  pageSize: queryInt.pipe(z.number().int().min(1).max(PAGE_SIZE_MAX)).default(PAGE_SIZE_DEFAULT),
});

export type SearchRequestInput = z.input<typeof searchRequestSchema>;
export type SearchRequest = z.output<typeof searchRequestSchema>;
