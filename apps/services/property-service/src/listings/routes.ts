import { type NextFunction, type Request, type Response, Router } from 'express';
import {
  type ErrorBody,
  exceedsResultWindow,
  idSchema,
  MAP_PIN_THRESHOLD_DEFAULT,
  type MapRequest,
  mapRequestSchema,
  type NeighborhoodsRequest,
  neighborhoodsRequestSchema,
  NOT_FOUND_BODY,
  propertyLookupRequestSchema,
  type PropertyPage,
  RESULT_WINDOW_EXCEEDED_BODY,
  type SearchRequest,
  searchRequestSchema,
} from '@cribstop/property-contracts';
import type { GalleryLoader } from './gallery-loader';
import { findMapPins } from './map-query';
import { resolvedSearchRequest } from './on-demand';
import {
  type AddressFetcher,
  findHomePage,
  findListingHomePage,
  lookupProperty,
} from './property-page';
import {
  findBrightListingKeys,
  findListingById,
  getListingsMeta,
  getNeighborhoods,
  type ReadPool,
  searchListings,
} from './repository';

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
type ParseResult<T> = { ok: true; value: T } | { ok: false; body: ErrorBody };

/**
 * A parameter name safe to reflect. Names ARE caller-controlled — an unknown-key issue reports the key
 * the caller invented — so the value is filtered to an identifier-ish shape and truncated rather than
 * echoed. Anything else becomes a fixed placeholder: naming the offending parameter is worth a lot for
 * debuggability, and worth nothing if it turns the error body into a reflection surface.
 */
function safeParameterName(name: string): string {
  const trimmed = name.slice(0, 40);
  return /^[A-Za-z0-9_.-]+$/.test(trimmed) ? trimmed : '(unnamed)';
}

function parseQuery(schema: typeof searchRequestSchema, query: unknown): ParseResult<SearchRequest>;
function parseQuery(schema: typeof mapRequestSchema, query: unknown): ParseResult<MapRequest>;
function parseQuery(
  schema: typeof neighborhoodsRequestSchema,
  query: unknown,
): ParseResult<NeighborhoodsRequest>;
function parseQuery(
  schema: typeof searchRequestSchema | typeof mapRequestSchema | typeof neighborhoodsRequestSchema,
  query: unknown,
): ParseResult<SearchRequest | MapRequest | NeighborhoodsRequest> {
  const parsed = schema.safeParse(query);
  if (parsed.success) {
    return { ok: true as const, value: parsed.data };
  }

  // The two rejection classes are reported separately because they send the reader to different
  // places. An UNKNOWN parameter means a typo or an attempt at field selection, so the message says
  // that no such parameter exists. A KNOWN parameter with a bad value (`pageSize=101`, above the
  // documented maximum of 100) means the name was right and the value was not — calling that
  // "unknown" sends whoever is debugging it hunting for a misspelling that is not there. Both are
  // still 400; only the wording differs.
  const unknownParameters = new Set<string>();
  const invalidValues = new Set<string>();

  for (const issue of parsed.error.issues) {
    // A strict-object rejection is reported as `unrecognized_keys`, whose `path` is EMPTY — the
    // offending names live in `issue.keys`. Reading only `path` (the obvious implementation)
    // therefore reports every typo'd or field-selection parameter as "(request)", which tells the
    // caller nothing about which of their parameters was wrong. Verified against a live request.
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        unknownParameters.add(safeParameterName(key));
      }
      continue;
    }
    invalidValues.add(
      issue.path.length > 0 ? safeParameterName(String(issue.path[0])) : '(request)',
    );
  }

  const sentences: string[] = [];
  if (unknownParameters.size > 0) {
    sentences.push(
      `Unknown query parameter(s): ${[...unknownParameters].join(', ')}. Unknown parameters are ` +
        'rejected; there is no field-selection parameter.',
    );
  }
  if (invalidValues.size > 0) {
    sentences.push(`Invalid value for query parameter(s): ${[...invalidValues].join(', ')}.`);
  }

  return { ok: false as const, body: invalidRequest(sentences.join(' ')) };
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

export function createListingsRouter(
  pool: ReadPool,
  galleryLoader?: GalleryLoader,
  addressFetcher?: AddressFetcher,
  mapPinThreshold = MAP_PIN_THRESHOLD_DEFAULT,
): Router {
  const router = Router();

  router.get(
    '/listings',
    asyncRoute(async (req: Request, res: Response) => {
      const parsed = parseQuery(searchRequestSchema, req.query);
      if (!parsed.ok) {
        res.status(400).json(parsed.body);
        return;
      }
      /**
       * The result-window bound (#65), enforced HERE — after a successful parse, before any SQL
       * runs. Two consequences of that placement are the whole point:
       *
       *  - It is upstream of `buildSearchQuery` and `searchListings`, so it applies identically to
       *    every sort and every filter combination by construction rather than by remembering to
       *    repeat it. There is no query shape that can reach the database past the window.
       *  - The expensive exact `COUNT(*)` never runs for a rejected request, so the cheapest thing
       *    to script stops being the most expensive thing we serve.
       *
       * It is a route-level check rather than a `.superRefine` on `searchRequestSchema` because it
       * carries its OWN status body and code: a schema rejection is reported as `invalid_request`
       * by `parseSearchRequest` above, and collapsing "this parameter is malformed" into "this
       * endpoint will not page that deep" is exactly the distinction the separate code exists to
       * preserve.
       *
       * This is NOT the past-the-end rule and must never be conflated with it. A page beyond the
       * last result but inside the window is a 200 with an empty `results` and the correct `total`
       * — only crossing the window boundary is a 400. Clamping to the last valid page instead
       * would teach an integrator that paging works when it does not.
       */
      if (exceedsResultWindow(parsed.value)) {
        res.status(400).json(RESULT_WINDOW_EXCEEDED_BODY);
        return;
      }
      // No column stores `query=Frederick, MD` as one string. The search runs against the place
      // `resolvedSearchRequest()` parsed out of it instead (`on-demand.ts`). `appliedFilters` below
      // echoes that resolved request, city/state in place of query, because it is what actually ran.
      const effectiveRequest = resolvedSearchRequest(parsed.value);
      const envelope = await searchListings(pool, effectiveRequest);
      // Postgres only. The sync worker (#338) keeps the database current, so search never calls
      // Bright and never waits on it.
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

  // #377. Registered before `/listings/:id` for the same reason as `/listings/meta`.
  router.get(
    '/listings/map',
    asyncRoute(async (req: Request, res: Response) => {
      const parsed = parseQuery(mapRequestSchema, req.query);
      if (!parsed.ok) {
        res.status(400).json(parsed.body);
        return;
      }
      const map = await findMapPins(pool, parsed.value, mapPinThreshold);
      res.set('Cache-Control', LISTINGS_CACHE_CONTROL).status(200).json(map);
    }),
  );

  // #390. Registered before `/listings/:id` for the same reason as `/listings/meta` and
  // `/listings/map`.
  router.get(
    '/listings/neighborhoods',
    asyncRoute(async (req: Request, res: Response) => {
      const parsed = parseQuery(neighborhoodsRequestSchema, req.query);
      if (!parsed.ok) {
        res.status(400).json(parsed.body);
        return;
      }
      const envelope = await getNeighborhoods(pool, parsed.value);
      // Same cache policy as /listings/meta: an aggregate read from an index or the search view, safe for the
      // shared cache to hold far longer than the browser does.
      res.set('Cache-Control', META_CACHE_CONTROL).status(200).json(envelope);
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
      let detail = await findListingById(pool, id.data);
      if (detail === null) {
        notFound(res);
        return;
      }
      let cacheControl = LISTINGS_CACHE_CONTROL;
      // A Bright listing opened with at most its ListPictureURL photo fetches its full gallery
      // (`gallery-loader.ts`). A fetch still running when the wait ends must not be cached.
      if (
        galleryLoader !== undefined &&
        detail.listing.source === 'brightMLS' &&
        detail.listing.media.length <= 1
      ) {
        const keys = await findBrightListingKeys(pool, id.data);
        if (keys !== null) {
          const outcome = await galleryLoader.loadGallery(keys);
          if (outcome === 'loaded') {
            detail = (await findListingById(pool, id.data)) ?? detail;
          } else if (outcome === 'pending') {
            cacheControl = 'no-store';
          }
        }
      }
      res.set('Cache-Control', cacheControl).status(200).json(detail);
    }),
  );

  /**
   * #382. The property page, from a listing id (the old `/listing/<id>` URL) or a home id. A
   * Bright latest listing with at most one photo fetches its gallery first, as `/listings/:id` does.
   */
  const sendPage = async (
    res: Response,
    load: () => Promise<PropertyPage | null>,
  ): Promise<void> => {
    let page = await load();
    if (page === null) {
      notFound(res);
      return;
    }
    let cacheControl = LISTINGS_CACHE_CONTROL;
    const latest = page.latestListing;
    if (
      galleryLoader !== undefined &&
      latest !== null &&
      latest.listing.source === 'brightMLS' &&
      latest.listing.media.length <= 1
    ) {
      const keys = await findBrightListingKeys(pool, latest.listing.id);
      if (keys !== null) {
        const outcome = await galleryLoader.loadGallery(keys);
        if (outcome === 'loaded') {
          page = (await load()) ?? page;
        } else if (outcome === 'pending') {
          cacheControl = 'no-store';
        }
      }
    }
    res.set('Cache-Control', cacheControl).status(200).json(page);
  };

  router.get(
    '/listings/:id/page',
    asyncRoute(async (req: Request, res: Response) => {
      const id = idSchema.safeParse(req.params.id);
      if (!id.success) {
        notFound(res);
        return;
      }
      await sendPage(res, () => findListingHomePage(pool, id.data));
    }),
  );

  router.get(
    '/properties/:id/page',
    asyncRoute(async (req: Request, res: Response) => {
      const id = idSchema.safeParse(req.params.id);
      if (!id.success) {
        notFound(res);
        return;
      }
      await sendPage(res, () => findHomePage(pool, id.data));
    }),
  );

  // #349. Resolves `/<city>-<st>/<address-slug>` to listings, reading the MLS once on a miss.
  router.get(
    '/properties/lookup',
    asyncRoute(async (req: Request, res: Response) => {
      const parsed = propertyLookupRequestSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json(invalidRequest('Query parameters city and address are required.'));
        return;
      }
      const result = await lookupProperty(pool, parsed.data, addressFetcher);
      if (result.kind === 'invalid') {
        res.status(400).json(invalidRequest('The city and address do not form a property path.'));
        return;
      }
      if (result.kind === 'not-found') {
        notFound(res);
        return;
      }
      res
        .set('Cache-Control', LISTINGS_CACHE_CONTROL)
        .status(200)
        .json({ matches: result.matches });
    }),
  );

  return router;
}
