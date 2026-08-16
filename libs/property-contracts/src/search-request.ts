import { z } from 'zod';
import { AMENITIES, amenitySchema, LISTING_TYPES, PROPERTY_TYPES } from './common';

/** Preserves the client's existing paging arithmetic in
 *  `apps/clients/cribstop/next/src/app/(with-search)/search/page.tsx`. */
export const PAGE_SIZE_DEFAULT = 20;
export const PAGE_SIZE_MAX = 100;

const queryInt = z.string().regex(/^\d+$/, 'must be a whole number').transform(Number);

/** `baths` alone tolerates a half step: `baths_display` in
 *  `apps/services/property-service/migrations/1785801600003_create-listings.js` is
 *  `COALESCE(baths_full,0) + 0.5*COALESCE(baths_half,0)`, so `2.5`/`3.5` are legitimate values. */
const queryBathCount = z
  .string()
  .regex(/^\d+(\.5)?$/, 'must be a whole number or a half step (e.g. 2.5)')
  .transform(Number);

/**
 * `.min()`/`.max()` on the far side of a `.pipe()` are invisible to `z.toJSONSchema({io:
 * 'input'})` — it only sees the string source schema, so a bare `queryInt.pipe(...).default(...)`
 * silently drops the bound from the published contract even though the service still enforces it
 * (#47 review, C1). The regex is tightened to the exact bound instead, so the published `pattern`
 * cannot say more than the service allows.
 */
const queryPage = z
  .string()
  .regex(/^[1-9]\d*$/, 'must be a positive whole number')
  .transform(Number)
  .pipe(z.number().int().min(1))
  .describe('Whole number, 1 or greater. Default 1.');

/** Mirrors `PAGE_SIZE_MAX` (100) exactly in the regex — if that constant ever changes, this
 *  pattern must change with it, or the published bound silently drifts from the enforced one. */
const queryPageSize = z
  .string()
  .regex(/^([1-9][0-9]?|100)$/, `must be a whole number from 1 to ${PAGE_SIZE_MAX}`)
  .transform(Number)
  .pipe(z.number().int().min(1).max(PAGE_SIZE_MAX))
  .describe(`Whole number from 1 to ${PAGE_SIZE_MAX}. Default ${PAGE_SIZE_DEFAULT}.`);

const queryBoolean = z.enum(['true', 'false']).transform((value) => value === 'true');

/**
 * Repeated param (`?amenities=Pool&amenities=Garage`) or comma list (`?amenities=Pool,Garage`).
 * The closed 15-value set is enforced by `.pipe(z.array(amenitySchema))`, but that enforcement
 * happens after the split/trim transform, so it is invisible to the published contract the same
 * way the paging bounds are (#47 review, C1). Validating each *branch* against `amenitySchema`
 * instead would publish the enum, but would also reject the comma-list and repeated-param forms
 * this transform exists to accept (a raw `"Pool,Garage"` string is not itself an enum member) —
 * so the transform stays and the closed set is documented instead of type-enforced in the spec.
 */
const amenityList = z
  .union([z.string(), z.array(z.string())])
  .transform((value) =>
    (Array.isArray(value) ? value : value.split(',')).map((entry) => entry.trim()).filter(Boolean),
  )
  .pipe(z.array(amenitySchema))
  .describe(`Comma-separated or repeated values from the closed set: ${AMENITIES.join(', ')}.`);

/**
 * The sort options, as a value array so a consumer can validate a URL parameter against them.
 *
 * Exported for the same reason as `LISTING_TYPES` and `AMENITIES`: a client parsing `?sort=` needs
 * the runtime list, and hand-listing it there means adding a sort here would silently leave that
 * client unable to accept it.
 */
export const SORT_VALUES = ['recommended', 'newest', 'price-asc', 'price-desc'] as const;
export const sortSchema = z.enum(SORT_VALUES);
export type ListingSort = z.infer<typeof sortSchema>;

/**
 * Strict on purpose. An unknown parameter is rejected rather than ignored, which kills the
 * silent-typo'd-filter bug (`?bed=3` quietly returning unfiltered results) and, more importantly,
 * leaves no room for a future field-selection parameter that could strip attribution.
 */
export const searchRequestSchema = z.strictObject({
  query: z.string().optional(),
  zip: z.string().optional(),
  street: z.string().optional(),
  // A flat enum, not `z.union([enumSchema, z.literal('all')])`: the inferred TS type is identical
  // (a literal union is flat regardless of which schema shape produced it) but the union form
  // renders in the published contract as a two-branch `anyOf` that loses the dropdown-friendly
  // single-enum shape codegen and Swagger UI expect (#47 review, I3).
  listingType: z.enum([...LISTING_TYPES, 'all'] as const).default('all'),
  propertyType: z.enum([...PROPERTY_TYPES, 'all'] as const).default('all'),
  minPrice: queryInt.optional(),
  maxPrice: queryInt.optional(),
  beds: queryInt.optional(),
  baths: queryBathCount.optional(),
  minSqft: queryInt.optional(),
  neighborhood: z.string().optional(),
  openHouse: queryBoolean.optional(),
  newConstruction: queryBoolean.optional(),
  waterfront: queryBoolean.optional(),
  petFriendly: queryBoolean.optional(),
  amenities: amenityList.optional(),
  sort: sortSchema.default('recommended'),
  page: queryPage.default(1),
  pageSize: queryPageSize.default(PAGE_SIZE_DEFAULT),
});

export type SearchRequestInput = z.input<typeof searchRequestSchema>;
export type SearchRequest = z.output<typeof searchRequestSchema>;
