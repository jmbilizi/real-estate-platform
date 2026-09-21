import { z } from 'zod';
import { MAX_RESULT_OFFSET } from './search-request';

export const errorBodySchema = z.object({
  error: z.object({
    code: z.enum([
      'invalid_request',
      'result_window_exceeded',
      'not_found',
      'internal_error',
      'rate_limited',
    ]),
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

/**
 * The single 400 body for a request past the reachable result window, frozen for the same reason as
 * the two above.
 *
 * It carries its OWN code rather than reusing `invalid_request`, because the two are different
 * facts and an integrator has to be able to tell them apart: `invalid_request` means "fix your
 * parameter" (a typo, a `pageSize` over the maximum), whereas this means "your parameters are
 * well-formed and this endpoint will not take you that deep — narrow the search instead". A client
 * that retried on `invalid_request` would loop forever here; one that branches on this code can
 * stop paging and say so.
 *
 * The message names the limit, in the same terms the OpenAPI description uses, so the constraint is
 * legible from the response alone. It carries no caller-supplied content — an error string is a
 * reflection surface — and, deliberately, does not name the last valid page: computing it is
 * trivial from the stated rule, and quoting it would read as an invitation to walk to exactly
 * there.
 */
export const RESULT_WINDOW_EXCEEDED_BODY = Object.freeze({
  error: Object.freeze({
    code: 'result_window_exceeded',
    message:
      `Result window exceeded: (page - 1) * pageSize must not exceed ${MAX_RESULT_OFFSET}. ` +
      'This is a search surface, not a bulk-export surface — narrow the search with filters ' +
      'rather than paging deeper.',
  } as const),
} as const);

/**
 * The single 429 body for `POST /listings/{id}/inquiries` (#131). Carries no caller-supplied
 * content — same reflection-surface reasoning as `RESULT_WINDOW_EXCEEDED_BODY` — and no `Retry-
 * After` value, because that varies with which of the per-IP/per-listing windows tripped; the
 * route sets the header separately.
 */
export const RATE_LIMITED_BODY = Object.freeze({
  error: Object.freeze({
    code: 'rate_limited',
    message: 'Too many inquiries from this client or for this listing. Try again later.',
  } as const),
} as const);

export type ErrorBody = z.infer<typeof errorBodySchema>;
