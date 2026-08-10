import { z } from 'zod';

export const errorBodySchema = z.object({
  error: z.object({
    code: z.enum(['invalid_request', 'not_found']),
    message: z.string(),
  }),
});

/**
 * The single 404 body. An unknown id, a soft-deleted id and a display-suppressed id must be
 * byte-identical: a distinguishable response is a confirmation oracle that defeats the opt-out.
 */
export const NOT_FOUND_BODY = Object.freeze({
  error: { code: 'not_found', message: 'Listing not found.' },
} as const);

export type ErrorBody = z.infer<typeof errorBodySchema>;
