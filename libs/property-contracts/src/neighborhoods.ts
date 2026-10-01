import { z } from 'zod';
import { stateCode } from './search-request';

/**
 * `GET /listings/neighborhoods` (#390): counts of publishable listings grouped by neighborhood, for
 * the home page's "Explore neighborhoods" row. No ranking, no descriptive word — counts only, so
 * this never becomes a second, unreviewed `featured` mechanism.
 *
 * #486: each row may carry `previewPhotos`, read live from the listings the row counts (sale, rent or both).
 * They are not ranking or featuring. Row order stays count based.
 */

export const NEIGHBORHOOD_PREVIEW_PHOTOS_MAX = 5;

export const NEIGHBORHOODS_LISTING_TYPES = ['sale', 'rent'] as const;

export const NEIGHBORHOODS_MIN_COUNT_DEFAULT = 3;
export const NEIGHBORHOODS_MIN_COUNT_MAX = 1000;
export const NEIGHBORHOODS_LIMIT_DEFAULT = 24;
export const NEIGHBORHOODS_LIMIT_MAX = 100;
export const NEIGHBORHOODS_PLACE_MAX = 25;

/**
 * Regex-tightened to the exact bound, mirroring `queryPage`/`queryPageSize` in `search-request.ts`
 * (#47 review, C1): a bare `.min()`/`.max()` on the far side of `.pipe()` is invisible to
 * `z.toJSONSchema({io: 'input'})`, so the published bound would silently say less than the service
 * enforces unless the regex itself carries it.
 */
const queryMinCount = z
  .string()
  .regex(/^([1-9]\d{0,2}|1000)$/, `must be a whole number from 1 to ${NEIGHBORHOODS_MIN_COUNT_MAX}`)
  .transform(Number)
  .pipe(z.number().int().min(1).max(NEIGHBORHOODS_MIN_COUNT_MAX))
  .describe(
    `Whole number from 1 to ${NEIGHBORHOODS_MIN_COUNT_MAX}. Default ${NEIGHBORHOODS_MIN_COUNT_DEFAULT}. ` +
      'A neighborhood whose matching count (see `listingType`) is below this is omitted.',
  );

const queryLimit = z
  .string()
  .regex(/^([1-9][0-9]?|100)$/, `must be a whole number from 1 to ${NEIGHBORHOODS_LIMIT_MAX}`)
  .transform(Number)
  .pipe(z.number().int().min(1).max(NEIGHBORHOODS_LIMIT_MAX))
  .describe(
    `Whole number from 1 to ${NEIGHBORHOODS_LIMIT_MAX}. Default ${NEIGHBORHOODS_LIMIT_DEFAULT}.`,
  );

/** `City, ST`: a non-empty city, a comma, then a two-letter state (the `stateCode` rule). */
const PLACE_PATTERN = /^\s*[^,\s][^,]*,\s*[A-Za-z]{2}\s*$/;
const placeItem = z.string().regex(PLACE_PATTERN, 'must be `City, ST` with a two-letter state');

/**
 * #488. Repeated param (`?place=Bethesda,MD&place=Chevy Chase,DC`); one occurrence is a one-item
 * list. Not comma-split: the comma inside each item separates city from state. The bound and the
 * format sit on the union branches because a `.max()` behind `.pipe()` is invisible to
 * `z.toJSONSchema({io: 'input'})` (same reason as `queryMinCount`).
 */
const queryPlaces = z
  .union([placeItem, z.array(placeItem).min(1).max(NEIGHBORHOODS_PLACE_MAX)])
  .transform((value) =>
    (Array.isArray(value) ? value : [value]).map((item) => {
      const at = item.lastIndexOf(',');
      return {
        city: item.slice(0, at).trim(),
        state: item
          .slice(at + 1)
          .trim()
          .toUpperCase(),
      };
    }),
  )
  .describe(
    'Repeatable `City, ST` (example `?place=Bethesda,MD&place=Chevy Chase,DC`), 1 to ' +
      `${NEIGHBORHOODS_PLACE_MAX} items, no duplicates (case-insensitive). City match is ` +
      'case-insensitive, state match is exact. Cannot combine with `city` or `state`.',
  );

/**
 * Strict, matching `searchRequestSchema`: an unknown parameter is a 400, not a silently ignored
 * typo.
 */
export const neighborhoodsRequestSchema = z
  .strictObject({
    place: queryPlaces.optional(),
    state: stateCode.optional(),
    city: z
      .string()
      .optional()
      .describe(
        'Case-insensitive exact match against the neighborhood’s city. Cannot combine with `place`.',
      ),
    listingType: z
      .enum([...NEIGHBORHOODS_LISTING_TYPES, 'all'] as const)
      .default('all')
      .describe(
        '`sale`, `rent` or `all` (default). Each returned row’s `total` counts only this type; ' +
          '`sale` and `rent` are always both reported regardless of this filter.',
      ),
    minCount: queryMinCount.default(NEIGHBORHOODS_MIN_COUNT_DEFAULT),
    limit: queryLimit.default(NEIGHBORHOODS_LIMIT_DEFAULT),
    slug: z
      .string()
      .optional()
      .describe('Exact match against the derived slug (see `NeighborhoodRow.slug`).'),
  })
  .superRefine((request, ctx) => {
    // Zod runs this check even when `place` itself failed to parse, so the value may be raw input.
    const places: unknown = request.place;
    if (!Array.isArray(places) || places.some((item) => typeof item !== 'object')) {
      return;
    }
    const conflicts = (['city', 'state'] as const).filter((key) => request[key] !== undefined);
    if (conflicts.length > 0) {
      const message = `\`place\` cannot combine with ${conflicts.map((k) => `\`${k}\``).join(' or ')}`;
      ctx.addIssue({ code: 'custom', path: ['place'], message });
      for (const key of conflicts) {
        ctx.addIssue({ code: 'custom', path: [key], message });
      }
    }
    const seen = new Set<string>();
    for (const { city, state } of places as NonNullable<typeof request.place>) {
      const key = `${city.toLowerCase()}|${state}`;
      if (seen.has(key)) {
        ctx.addIssue({ code: 'custom', path: ['place'], message: 'duplicate place' });
        return;
      }
      seen.add(key);
    }
  });

export type NeighborhoodsRequest = z.infer<typeof neighborhoodsRequestSchema>;

export const neighborhoodPreviewPhotoSchema = z.object({
  url: z.string().describe('The listing’s primary photo URL.'),
  listingId: z.string().describe('The listing the photo belongs to.'),
});

export type NeighborhoodPreviewPhoto = z.infer<typeof neighborhoodPreviewPhotoSchema>;

export const neighborhoodRowSchema = z.object({
  name: z.string(),
  city: z.string(),
  state: z.string(),
  slug: z.string(),
  total: z.number().int().nonnegative(),
  sale: z.number().int().nonnegative(),
  rent: z.number().int().nonnegative(),
  previewPhotos: z
    .array(neighborhoodPreviewPhotoSchema)
    .max(NEIGHBORHOOD_PREVIEW_PHOTOS_MAX)
    .optional()
    .describe(
      `Up to ${NEIGHBORHOOD_PREVIEW_PHOTOS_MAX} primary photos, one per listing, from the listings the row ` +
        'counts (sale, rent or both, per listingType). Newest listed first. Absent when no listing qualifies.',
    ),
});

export type NeighborhoodRow = z.infer<typeof neighborhoodRowSchema>;

/**
 * `total` here is the exact count of matching neighborhoods, never clamped to `limit` — the same
 * convention `ListingsEnvelope.total` follows, for the same reason (PRD §6.3: a clamped count is a
 * fabricated fact).
 */
export const neighborhoodsResponseSchema = z.object({
  results: z.array(neighborhoodRowSchema),
  total: z.number().int().nonnegative(),
});

export type NeighborhoodsResponse = z.infer<typeof neighborhoodsResponseSchema>;
