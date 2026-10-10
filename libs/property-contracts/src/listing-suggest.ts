import { z } from 'zod';

/**
 * `GET /listings/suggest` (#781): Where-field suggestions from the places the publishable listings
 * carry. A prefix match on city, ZIP and neighborhood. Replaces autocomplete against public
 * Nominatim, which its usage policy forbids.
 */

export const SUGGEST_Q_MIN = 2;
export const SUGGEST_Q_MAX = 40;
export const SUGGEST_LIMIT_DEFAULT = 8;
export const SUGGEST_LIMIT_MAX = 10;

export const SUGGEST_KINDS = ['city', 'zip', 'neighborhood'] as const;

/** Mirrors `queryMinCount` in `neighborhoods.ts`: the regex carries the published bound. */
const queryLimit = z
  .string()
  .regex(/^([1-9]|10)$/, `must be a whole number from 1 to ${SUGGEST_LIMIT_MAX}`)
  .transform(Number)
  .pipe(z.number().int().min(1).max(SUGGEST_LIMIT_MAX))
  .describe(`Whole number from 1 to ${SUGGEST_LIMIT_MAX}. Default ${SUGGEST_LIMIT_DEFAULT}.`);

export const suggestRequestSchema = z.strictObject({
  q: z
    .string()
    .trim()
    .min(SUGGEST_Q_MIN)
    .max(SUGGEST_Q_MAX)
    // A NUL byte or other control character makes Postgres raise an error (a 500).
    // eslint-disable-next-line no-control-regex
    .regex(/^[^\u0000-\u001f\u007f]+$/, 'must not contain control characters')
    .describe(
      `Prefix of a city, ZIP or neighborhood name. ${SUGGEST_Q_MIN} to ${SUGGEST_Q_MAX} characters.`,
    ),
  limit: queryLimit.optional(),
});

export type SuggestRequest = z.infer<typeof suggestRequestSchema>;

export const suggestionSchema = z.object({
  kind: z.enum(SUGGEST_KINDS),
  /** The city, the ZIP or the neighborhood name, as displayed. */
  name: z.string(),
  city: z.string(),
  /** Two-letter state. */
  state: z.string(),
  /** Present for a `zip` suggestion. */
  zip: z.string().optional(),
});

export type Suggestion = z.infer<typeof suggestionSchema>;

export const suggestResponseSchema = z.object({
  suggestions: z.array(suggestionSchema),
});

export type SuggestResponse = z.infer<typeof suggestResponseSchema>;
