import { z } from 'zod';
import {
  AMENITIES,
  amenitySchema,
  LISTING_TYPES,
  PROPERTY_TYPES,
  propertyTypeSchema,
  STATUS_FILTER_VALUES,
  statusFilterSchema,
} from './common';
import { areaPolygon } from './area-polygon';

/** Preserves the client's existing paging arithmetic in
 *  `apps/clients/cribstop/next/src/app/(with-search)/search/page.tsx`. */
export const PAGE_SIZE_DEFAULT = 20;
export const PAGE_SIZE_MAX = 100;

/**
 * The deepest offset — `(page - 1) * pageSize` — a caller may reach on `GET /listings`.
 *
 * This is the SECOND, independent paging bound, and it answers a different question from
 * `PAGE_SIZE_MAX`. The page-size ceiling bounds the cost of ONE request; this bounds how much of
 * the dataset is reachable by making MANY of them. Without it the whole consumer-visible set can be
 * walked `pageSize` rows at a time, which for a licensed IDX feed is a display-rule exposure (PRD
 * §6.2) rather than merely an infrastructure cost — and, because every page runs an exact
 * `COUNT(*)` over the filtered set, a scripted walk is simultaneously the cheapest thing to script
 * and the most expensive thing we serve.
 *
 * The bound is on DEPTH, never on whether filters were supplied: the unfiltered browse surface (the
 * footer's "Search All", the default search) is a deliberate shopping path, and "tell us where
 * before we show you anything" is friction a housing product should not add.
 *
 * At the default page size this reaches page 501, deep enough for a large city's full for-sale
 * count (#368: DC's ~3,400 listings hit the old 1,000-row/page-51 bound). The limit is on the
 * offset itself, as the acceptance criterion states it, so the deepest row reachable is
 * `MAX_RESULT_OFFSET + pageSize`.
 *
 * `total` is deliberately NOT clamped to this window. It stays the exact count of the full filtered
 * set, because it is what the headline result count and every "narrow your search" affordance are
 * built on — clamping it would be a fabricated fact (PRD §6.3).
 */
export const MAX_RESULT_OFFSET = 10_000;

/** #722. The `officeKey` value that matches listings with no office key. Real keys are digits. */
export const OFFICE_KEY_UNLISTED = 'unlisted';
export const OFFICE_KEY_PATTERN = new RegExp(`^(\\d{1,19}|${OFFICE_KEY_UNLISTED})$`);

/** The offset a `(page, pageSize)` pair asks the database for. One definition, so the bound the
 *  route enforces and the offset the repository issues cannot drift apart. */
export function resultOffsetFor(page: number, pageSize: number): number {
  return (page - 1) * pageSize;
}

/** The deepest page number still inside the window at a given page size (501 at the default 20).
 *  Exported so a client can bound its own pager rather than rendering a page button that 400s. */
export function maxReachablePage(pageSize: number): number {
  return Math.floor(MAX_RESULT_OFFSET / pageSize) + 1;
}

/** Whether a parsed request asks for a page past the reachable window. */
export function exceedsResultWindow(request: Pick<SearchRequest, 'page' | 'pageSize'>): boolean {
  return resultOffsetFor(request.page, request.pageSize) > MAX_RESULT_OFFSET;
}

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
  .describe(
    'Whole number, 1 or greater. Default 1. Paging depth is bounded: (page - 1) * pageSize must ' +
      `not exceed ${MAX_RESULT_OFFSET}, and a request past that returns 400. The bound is not ` +
      'expressed as a maximum on this parameter because the deepest valid page depends on ' +
      `pageSize (${maxReachablePage(PAGE_SIZE_DEFAULT)} at the default page size of ` +
      `${PAGE_SIZE_DEFAULT}).`,
  );

/** Mirrors `PAGE_SIZE_MAX` (100) exactly in the regex — if that constant ever changes, this
 *  pattern must change with it, or the published bound silently drifts from the enforced one. */
export const queryPageSize = z
  .string()
  .regex(/^([1-9][0-9]?|100)$/, `must be a whole number from 1 to ${PAGE_SIZE_MAX}`)
  .transform(Number)
  .pipe(z.number().int().min(1).max(PAGE_SIZE_MAX))
  .describe(`Whole number from 1 to ${PAGE_SIZE_MAX}. Default ${PAGE_SIZE_DEFAULT}.`);

const queryBoolean = z.enum(['true', 'false']).transform((value) => value === 'true');

/** Same reasoning as `queryPage`/`queryPageSize`: the bound is a regex, not a `.pipe()` `.max()`,
 *  because `z.toJSONSchema({io: 'input'})` cannot see past a `.pipe()`. */
const queryDaysUpTo30 = z
  .string()
  .regex(/^([1-9]|[12][0-9]|30)$/, 'must be a whole number from 1 to 30')
  .transform(Number);

/**
 * Vertex cap for a client-sent boundary polygon, checked BEFORE the character cap below so the
 * error names the actual problem (a huge polygon) rather than a generic length overflow.
 *
 * 500 is far more detail than a neighborhood/county outline needs at map zoom — the same
 * reasoning `nominatim.ts`'s `POLYGON_THRESHOLD` uses to simplify Nominatim's own boundaries
 * before this ever reaches the wire. This is a second, independent bound: the proxy's
 * simplification is the web app's own defense, and this one is the service's, so a boundary
 * cannot reach `ST_Intersects` unsimplified even from a caller that skips the proxy.
 */
const MAX_BOUNDARY_POINTS = 500;

/** Bytes, not points: a polygon can pack many points into few characters or few points into a
 *  verbose one, so both bounds are checked independently. */
const MAX_BOUNDARY_CHARS = 20_000;

function countBoundaryPoints(geometry: { type: string; coordinates: unknown }): number {
  const rings: unknown =
    geometry.type === 'Polygon'
      ? geometry.coordinates
      : geometry.type === 'MultiPolygon'
        ? (geometry.coordinates as unknown[]).flat(1)
        : [];
  return (rings as unknown[][]).reduce(
    (total, ring) => total + (Array.isArray(ring) ? ring.length : 0),
    0,
  );
}

/**
 * A GeoJSON `Polygon`/`MultiPolygon`, sent as a JSON string (query parameters carry text, not
 * objects). Validated, never parsed into the output shape: `search-query.ts` binds the string
 * as-is to `ST_GeomFromGeoJSON`, so Postgres is the one place that actually interprets the
 * geometry — this schema only bounds its size and confirms its shape.
 */
const boundaryPolygon = z
  .string()
  .max(MAX_BOUNDARY_CHARS, `must not exceed ${MAX_BOUNDARY_CHARS} characters`)
  .superRefine((value, ctx) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'must be valid JSON' });
      return;
    }
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !('type' in parsed) ||
      (parsed.type !== 'Polygon' && parsed.type !== 'MultiPolygon') ||
      !('coordinates' in parsed)
    ) {
      ctx.addIssue({ code: 'custom', message: 'must be a GeoJSON Polygon or MultiPolygon' });
      return;
    }
    const points = countBoundaryPoints(parsed as { type: string; coordinates: unknown });
    if (points > MAX_BOUNDARY_POINTS) {
      ctx.addIssue({ code: 'custom', message: `must not exceed ${MAX_BOUNDARY_POINTS} points` });
    }
  })
  .describe(
    'GeoJSON Polygon or MultiPolygon, as a JSON string, simplified client-side. ANDs with ' +
      `\`neighborhood\` when both are sent. Capped at ${MAX_BOUNDARY_POINTS} points and ` +
      `${MAX_BOUNDARY_CHARS} characters.`,
  );

/**
 * Exactly two letters, case-insensitive. Anything else is the contract's normal 400.
 * Exported for `neighborhoods.ts`, so the two `state` query parameters cannot drift apart.
 */
export const stateCode = z
  .string()
  .regex(/^[A-Za-z]{2}$/, 'must be a two-letter state code')
  .describe(
    'Two-letter state code, case-insensitive exact match (e.g. `MD`). ANDed with every other ' +
      'filter, including `query` — no parameter suppresses another. Full state names are the ' +
      'client’s job to normalize before sending this parameter.',
  );

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

/** Any of the listed types matches. `all`, or no value, means every type. */
const propertyTypeList = z
  .union([z.string(), z.array(z.string())])
  .transform((value) =>
    (Array.isArray(value) ? value : value.split(','))
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0 && entry !== 'all'),
  )
  .pipe(z.array(propertyTypeSchema))
  .describe(
    `Comma-separated or repeated values: ${PROPERTY_TYPES.join(', ')}. 'all' means every type.`,
  );

/**
 * Matches Zillow/Homes.com: a shopping search defaults to homes still on the market. `Sold` is
 * excluded from `STATUS_FILTER_VALUES` entirely (#33), so this default cannot drift to include it.
 */
export const DEFAULT_STATUS_FILTER: readonly (typeof STATUS_FILTER_VALUES)[number][] = [
  'Active',
  'Coming Soon',
];

/**
 * True when `status` holds exactly `DEFAULT_STATUS_FILTER`'s distinct values, any order, any
 * duplicates — i.e. the caller never narrowed this filter.
 *
 * The single shared definition: `property-service`'s search query and the web client's URL parser
 * and filter modal all need this same comparison, and each keeping its own copy is exactly the
 * kind of drift a second implementation of one predicate always risks.
 */
export function isDefaultStatusFilter(status: readonly string[]): boolean {
  const distinct = new Set(status);
  return (
    distinct.size === DEFAULT_STATUS_FILTER.length &&
    DEFAULT_STATUS_FILTER.every((value) => distinct.has(value))
  );
}

/**
 * Any of the listed statuses matches. Omission means `DEFAULT_STATUS_FILTER`. An explicit empty
 * value (`?status=`) means it too.
 *
 * The empty case is folded back to the default INSIDE the transform, not left for `.default()`.
 * `.default()` only fires when the key is absent. A bare `?status=` parses to a defined `''`, so
 * without this fold it would reach `search-query.ts` as `[]`. That skips the status condition
 * entirely and widens the search to every status, Under Contract included.
 */
const statusList = z
  .union([z.string(), z.array(z.string())])
  .transform((value) => {
    const cleaned = (Array.isArray(value) ? value : value.split(','))
      .map((entry) => entry.trim())
      .filter(Boolean);
    return cleaned.length > 0 ? cleaned : [...DEFAULT_STATUS_FILTER];
  })
  .pipe(z.array(statusFilterSchema))
  .describe(
    `Comma-separated or repeated values from the closed set: ${STATUS_FILTER_VALUES.join(', ')}. ` +
      `Default when omitted or empty: ${DEFAULT_STATUS_FILTER.join(', ')}. ` +
      '\'Pending\' means "Under Contract" to consumers. It covers both the Active Under ' +
      'Contract and Pending MLS statuses. Sold is not a value here. No sold listing publishes ' +
      'in search yet.',
  );

/**
 * The sort options, as a value array so a consumer can validate a URL parameter against them.
 *
 * Exported for the same reason as `LISTING_TYPES` and `AMENITIES`: a client parsing `?sort=` needs
 * the runtime list, and hand-listing it there means adding a sort here would silently leave that
 * client unable to accept it.
 */
export const SORT_VALUES = [
  'recommended',
  'newest',
  'newly-listed',
  'price-asc',
  'price-desc',
] as const;
export const sortSchema = z
  .enum(SORT_VALUES)
  .describe(
    '`price-asc` and `price-desc` place a listing with a seller-suppressed price (#53) LAST, ' +
      'regardless of direction — `NULLS LAST` on both, not the SQL default of `NULLS FIRST` on ' +
      'DESC. A suppressed-price row is never lost from the result, only ordered after every row ' +
      'that has a price.',
  );
export type ListingSort = z.infer<typeof sortSchema>;

/** `west,south,east,north` in degrees. The antimeridian is out of scope for this market. */
export const searchBoundsSchema = z
  .string()
  .regex(/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/, 'must be four numbers: west,south,east,north')
  .transform((value) => {
    const [west, south, east, north] = value.split(',').map(Number) as [
      number,
      number,
      number,
      number,
    ];
    return { west, south, east, north };
  })
  .pipe(
    z
      .object({
        west: z.number().min(-180).max(180),
        south: z.number().min(-90).max(90),
        east: z.number().min(-180).max(180),
        north: z.number().min(-90).max(90),
      })
      .refine((b) => b.west < b.east && b.south < b.north, 'west < east and south < north'),
  )
  .describe(
    'Viewport as `west,south,east,north` in decimal degrees. West must be less than east and ' +
      'south less than north. A listing whose seller withheld the address has no coordinates, ' +
      'so it never matches a viewport.',
  );

/**
 * Strict on purpose. An unknown parameter is rejected rather than ignored, which kills the
 * silent-typo'd-filter bug (`?bed=3` quietly returning unfiltered results) and, more importantly,
 * leaves no room for a future field-selection parameter that could strip attribution.
 */
export const searchRequestSchema = z.strictObject({
  query: z.string().optional(),
  zip: z.string().optional(),
  street: z.string().optional(),
  city: z
    .string()
    .optional()
    .describe(
      'Case-insensitive EXACT match, not substring — a place name, not a search term. ANDed ' +
        'with every other filter, including `query`. Mirrors `neighborhood`: a substring match ' +
        'would make `Ken` match `Kensington`.',
    ),
  state: stateCode.optional(),
  // A flat enum, not `z.union([enumSchema, z.literal('all')])`: the inferred TS type is identical
  // (a literal union is flat regardless of which schema shape produced it) but the union form
  // renders in the published contract as a two-branch `anyOf` that loses the dropdown-friendly
  // single-enum shape codegen and Swagger UI expect (#47 review, I3).
  listingType: z.enum([...LISTING_TYPES, 'all'] as const).default('all'),
  propertyType: propertyTypeList.default([]),
  status: statusList.default([...DEFAULT_STATUS_FILTER]),
  // A seller may suppress `price` (#53); a suppressed row's price is null. `NULL >= x` and
  // `NULL <= x` are never true, so these two filters exclude a suppressed-price row from every
  // range they express — never a false match, and never a special case in search-query.ts.
  minPrice: queryInt
    .optional()
    .describe(
      'Whole number. A listing with a seller-suppressed price never matches this filter, ' +
        'because it has no price to compare.',
    ),
  maxPrice: queryInt
    .optional()
    .describe(
      'Whole number. A listing with a seller-suppressed price never matches this filter, ' +
        'because it has no price to compare.',
    ),
  beds: queryInt.optional(),
  baths: queryBathCount.optional(),
  minSqft: queryInt.optional(),
  neighborhood: z.string().optional(),
  officeKey: z
    .string()
    .regex(OFFICE_KEY_PATTERN, 'must be a numeric office key or `unlisted`')
    .optional()
    .describe(
      'The listing office, by its MLS office key. A drill-down from a broker group, not a ' +
        'search box. `unlisted` matches the listings that carry no office key. It is an exact ' +
        'match, ANDed with every other filter.',
    ),
  // #339. Matched against `county_fips` (case-insensitive exact), which the Bright ingest does not
  // populate yet (tracked separately) — a plain `county` search returns zero rows rather than an
  // unfiltered one until that ships. This is a FIPS CODE column, not a name, so the web client
  // never sends this parameter (it has no FIPS lookup) — `boundary` is its county mechanism.
  county: z
    .string()
    .optional()
    .describe(
      'A 5-digit county FIPS code, matched exactly (case-insensitive) against county_fips. ' +
        'ANDed with every other filter. A caller without a FIPS code should send `boundary` ' +
        'instead — this and `boundary` should not both be sent for the same conceptual place.',
    ),
  boundary: boundaryPolygon.optional(),
  // #747. The user's drawn shape. `boundary` is the place outline, `area` is the user's shape.
  area: areaPolygon.optional(),
  bounds: searchBoundsSchema.optional(),
  openHouse: queryBoolean.optional(),
  newConstruction: queryBoolean.optional(),
  waterfront: queryBoolean.optional(),
  petFriendly: queryBoolean.optional(),
  amenities: amenityList.optional(),
  // #391. A listing with no `listed_at` never matches — the same "never a false match" rule
  // minPrice/maxPrice already apply to a seller-suppressed price.
  listedWithinDays: queryDaysUpTo30
    .optional()
    .describe(
      'Whole number, 1 to 30. Matches a listing whose listed_at is within this many days of now. ' +
        'A listing with no listed_at (the feed carried no list date) never matches.',
    ),
  // Restricts only when true, matching `openHouse`/`newConstruction` above.
  priceReduced: queryBoolean.optional(),
  sort: sortSchema.default('recommended'),
  page: queryPage.default(1),
  pageSize: queryPageSize.default(PAGE_SIZE_DEFAULT),
});

export type SearchRequestInput = z.input<typeof searchRequestSchema>;
export type SearchRequest = z.output<typeof searchRequestSchema>;
