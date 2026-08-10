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
 * Frozen at both levels — this is a single shared object handed straight to `res.json(...)` by
 * every 404 call site, so a careless in-place write (e.g. `body.error.message = ...`) must throw
 * rather than silently rewriting every subsequent 404 process-wide. `Object.freeze` is shallow,
 * so the nested `error` object is frozen explicitly, not just the outer one.
 */
export const NOT_FOUND_BODY = Object.freeze({
  error: Object.freeze({ code: 'not_found', message: 'Listing not found.' } as const),
} as const);

export type ErrorBody = z.infer<typeof errorBodySchema>;
