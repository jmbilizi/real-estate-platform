import { type NextFunction, type Request, type Response, Router } from 'express';
import {
  type ErrorBody,
  idSchema,
  NOT_FOUND_BODY,
  type SavedHomesEnvelope,
  savedHomesRequestSchema,
  type SavedState,
  UNAUTHENTICATED_BODY,
} from '@cribstop/property-contracts';
import type { IntrospectionClient } from '../inquiries/account-introspection';
import { findPropertyRecord, type ReadClient } from '../listings/repository';
import { propertyIdOf } from '../listings/property-page';
import { buildSavedHomes } from './homes';
import { identifyAccount, PRIVATE_CACHE_CONTROL } from './identity';
import { countSavedHomes, listSavedHomeRows, saveHome, unsaveHome } from './store';

/**
 * The saved-homes resource of the Property API (#23). Every route needs an account. Every
 * statement is scoped to the calling account, so no route reads or changes another account's
 * saves. Every response is `private, no-store`.
 *
 * A save keys on the home, never on the listing. `PUT /listings/:id/saved` resolves the home of the
 * listing here, so the client does not need a property id.
 */

const invalidRequest = (message: string): ErrorBody => ({
  error: { code: 'invalid_request', message },
});

/** Mirrors `listings/routes.ts`'s `asyncRoute`: Express 4 does not await handlers. */
const asyncRoute =
  (handler: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next);
  };

/** A parameter name safe to reflect. Same reasoning as `listings/routes.ts`. */
function safeName(name: string): string {
  const trimmed = name.slice(0, 40);
  return /^[A-Za-z0-9_.-]+$/.test(trimmed) ? trimmed : '(unnamed)';
}

export interface SavedHomesRouterDeps {
  pool: ReadClient;
  introspection: IntrospectionClient;
}

export function createSavedHomesRouter(deps: SavedHomesRouterDeps): Router {
  const router = Router();
  const { pool, introspection } = deps;

  /** The calling account, or `null` after sending the one 401. Runs before any other check, so a
   *  signed-out caller learns nothing about which ids exist. */
  async function requireAccount(req: Request, res: Response): Promise<string | null> {
    res.set('Cache-Control', PRIVATE_CACHE_CONTROL);
    const accountId = await identifyAccount(introspection, req);
    if (accountId === null) {
      res.status(401).json(UNAUTHENTICATED_BODY);
    }
    return accountId;
  }

  /** The home a listing is on, through `listing_detail_v`. An unknown, deleted or withheld listing
   *  is the one frozen 404, so a save cannot confirm a listing the seller withheld. */
  async function homeOfListing(res: Response, rawId: string | undefined): Promise<string | null> {
    const id = idSchema.safeParse(rawId);
    const row = id.success ? await findPropertyRecord(pool, id.data) : null;
    if (row === null) {
      res.status(404).json(NOT_FOUND_BODY);
      return null;
    }
    return propertyIdOf(row);
  }

  router.put(
    '/listings/:id/saved',
    asyncRoute(async (req, res) => {
      const accountId = await requireAccount(req, res);
      if (accountId === null) return;
      const homeId = await homeOfListing(res, req.params.id);
      if (homeId === null) return;
      await saveHome(pool, accountId, homeId, req.params.id?.toLowerCase() ?? null);
      const body: SavedState = { propertyId: homeId, saved: true };
      res.status(200).json(body);
    }),
  );

  router.delete(
    '/listings/:id/saved',
    asyncRoute(async (req, res) => {
      const accountId = await requireAccount(req, res);
      if (accountId === null) return;
      const homeId = await homeOfListing(res, req.params.id);
      if (homeId === null) return;
      await unsaveHome(pool, accountId, homeId);
      const body: SavedState = { propertyId: homeId, saved: false };
      res.status(200).json(body);
    }),
  );

  router.delete(
    '/saved-homes/:id',
    asyncRoute(async (req, res) => {
      const accountId = await requireAccount(req, res);
      if (accountId === null) return;
      const id = idSchema.safeParse(req.params.id);
      if (!id.success) {
        res.status(404).json(NOT_FOUND_BODY);
        return;
      }
      const homeId = id.data.toLowerCase();
      await unsaveHome(pool, accountId, homeId);
      const body: SavedState = { propertyId: homeId, saved: false };
      res.status(200).json(body);
    }),
  );

  router.get(
    '/saved-homes',
    asyncRoute(async (req, res) => {
      const accountId = await requireAccount(req, res);
      if (accountId === null) return;
      const parsed = savedHomesRequestSchema.safeParse(req.query);
      if (!parsed.success) {
        const names = new Set<string>();
        for (const issue of parsed.error.issues) {
          if (issue.code === 'unrecognized_keys') {
            for (const key of issue.keys) names.add(safeName(key));
          } else {
            names.add(issue.path.length > 0 ? safeName(String(issue.path[0])) : '(request)');
          }
        }
        res
          .status(400)
          .json(invalidRequest(`Invalid query parameter(s): ${[...names].join(', ')}.`));
        return;
      }
      const { page, pageSize } = parsed.data;
      const [total, rows] = await Promise.all([
        countSavedHomes(pool, accountId),
        listSavedHomeRows(pool, accountId, pageSize, (page - 1) * pageSize),
      ]);
      const body: SavedHomesEnvelope = {
        results: await buildSavedHomes(pool, rows),
        total,
        page,
        pageSize,
        pageCount: Math.ceil(total / pageSize),
      };
      res.status(200).json(body);
    }),
  );

  return router;
}
