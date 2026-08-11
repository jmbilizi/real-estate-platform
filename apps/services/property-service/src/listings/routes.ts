import { type NextFunction, type Request, type Response, Router } from 'express';
import {
  type ErrorBody,
  idSchema,
  NOT_FOUND_BODY,
  type SearchRequest,
  searchRequestSchema,
} from '@cribstop/property-contracts';
import { findListingById, getListingsMeta, type ReadPool, searchListings } from './repository';

/**
 * The Property API's HTTP surface. `property-service` owns Communities → Properties → Units →
 * Listings, so this is the Property API; `listings` is the resource, which is why the paths are
 * `/listings/*`. A service name is not a resource name.
 */

/**
 * `/listings` and `/listings/{id}` embed a time-relative fact — the upcoming open house — so a long
 * TTL would keep serving a showing that has finished. 60s is the ceiling.
 *
 * Deliberately NOT `no-store`: these payloads carry no PII (no `isSaved`, no per-user ranking, nothing
 * derived from a caller identity) and must not start to. Making them uncacheable would be paying a
 * permanent cost for privacy we do not need here, and would quietly license adding per-user fields
 * later.
 */
const LISTINGS_CACHE_CONTROL = 'public, max-age=60';

/**
 * `/listings/meta` is an indexed `MAX` plus a `COUNT` — cheap, and five minutes is an order of
 * magnitude tighter than any MLS refresh obligation, so the shared cache can hold it far longer than
 * the browser. The browser TTL stays short because `Footer` renders on every route, so a long session
 * must not drift.
 */
const META_CACHE_CONTROL = 'public, max-age=60, s-maxage=300, stale-while-revalidate=60';

const invalidRequest = (message: string): ErrorBody => ({
  error: { code: 'invalid_request', message },
});

/**
 * Strict parsing. `searchRequestSchema` is a `z.strictObject`, so an unknown parameter is REJECTED
 * rather than ignored. That does two jobs at once: it kills the silent-typo'd-filter bug (`?bed=3`
 * quietly returning unfiltered results), and it structurally forecloses any future field-selection
 * parameter that could strip the NAR 7.58 attribution block. There is no `fields=`, no sparse
 * fieldset, and no way to add one without this failing.
 *
 * The message names the offending parameters but does not echo their values back — an error string is
 * a reflection surface, and there is no reason to put caller-controlled content in one.
 */
type ParseResult = { ok: true; value: SearchRequest } | { ok: false; body: ErrorBody };

function parseSearchRequest(query: unknown): ParseResult {
  const parsed = searchRequestSchema.safeParse(query);
  if (parsed.success) {
    return { ok: true as const, value: parsed.data };
  }
  const offending = [
    ...new Set(
      parsed.error.issues.map((issue) =>
        issue.path.length > 0 ? String(issue.path[0]) : '(request)',
      ),
    ),
  ];
  return {
    ok: false as const,
    body: invalidRequest(
      `Invalid query parameter(s): ${offending.join(', ')}. Unknown parameters are rejected; ` +
        'there is no field-selection parameter.',
    ),
  };
}

/** The one 404. Shared so every call site is byte-identical by construction, not by discipline. */
function notFound(res: Response): void {
  res.status(404).json(NOT_FOUND_BODY);
}

/**
 * Express 4 does not await handlers, so a rejected promise from an `async` one never reaches the error
 * middleware: the request simply hangs until the client gives up, which surfaces as a gateway timeout
 * and points whoever debugs it at the wrong layer. Every async handler below is wrapped so a database
 * failure becomes a 500 with a logged cause. Express 5 makes this unnecessary; until the upgrade, the
 * wrapper is the seam and forgetting it is a silent-hang bug.
 */
const asyncRoute =
  (handler: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next);
  };

export function createListingsRouter(pool: ReadPool): Router {
  const router = Router();

  router.get(
    '/listings',
    asyncRoute(async (req: Request, res: Response) => {
      const parsed = parseSearchRequest(req.query);
      if (!parsed.ok) {
        res.status(400).json(parsed.body);
        return;
      }
      const envelope = await searchListings(pool, parsed.value);
      res.set('Cache-Control', LISTINGS_CACHE_CONTROL).status(200).json(envelope);
    }),
  );

  /**
   * Registered BEFORE `/listings/:id` so the literal cannot be captured by the parameterised route.
   * The gateway route file mirrors this with an explicit Ocelot `Priority`, because Ocelot has the
   * same hazard and neither layer's ordering protects the other.
   */
  router.get(
    '/listings/meta',
    asyncRoute(async (_req: Request, res: Response) => {
      const meta = await getListingsMeta(pool);
      res.set('Cache-Control', META_CACHE_CONTROL).status(200).json(meta);
    }),
  );

  router.get(
    '/listings/:id',
    asyncRoute(async (req: Request, res: Response) => {
      // The id is validated with the contract's own `idSchema` rather than a hand-written regex, so the
      // route and the published `/listings/{id}` path parameter cannot diverge. A malformed id takes the
      // SAME 404 as an unknown one: a 400 here would tell a caller "that was a well-formed id that does
      // not exist" versus "that was not an id", and the whole point is that the three
      // indistinguishable cases — unknown, soft-deleted, and seller-suppressed — stay indistinguishable.
      const id = idSchema.safeParse(req.params.id);
      if (!id.success) {
        notFound(res);
        return;
      }
      const detail = await findListingById(pool, id.data);
      if (detail === null) {
        notFound(res);
        return;
      }
      res.set('Cache-Control', LISTINGS_CACHE_CONTROL).status(200).json(detail);
    }),
  );

  return router;
}
