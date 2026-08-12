import { z } from 'zod';

export const errorBodySchema = z.object({
  error: z.object({
    code: z.enum(['invalid_request', 'not_found', 'internal_error']),
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

/**
 * The single 500 body, frozen for the same reason as `NOT_FOUND_BODY`.
 *
 * It lives here rather than as a literal in the service's error boundary because a hand-written
 * literal is not covered by `errorBodySchema` — `internal_error` was missing from the `code` enum
 * for exactly as long as the body was written by hand, so the contract could not represent a
 * response the service was routinely emitting, and a client generated from this package had no
 * branch that could deserialise it.
 *
 * The message is deliberately opaque and carries no detail: a `pg` error names tables, columns and
 * constraint text, and these are public unauthenticated endpoints. The cause belongs in the log.
 */
export const INTERNAL_ERROR_BODY = Object.freeze({
  error: Object.freeze({ code: 'internal_error', message: 'Internal server error.' } as const),
} as const);

export type ErrorBody = z.infer<typeof errorBodySchema>;
