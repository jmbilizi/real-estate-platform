import { type NextFunction, type Request, type Response, Router } from 'express';
import {
  idSchema,
  LOOKING_FOR_LIMIT_BODY,
  LOOKING_FOR_MAX_PER_ACCOUNT,
  type LookingForInvalidBody,
  type LookingForList,
  lookingForRequestSchema,
  SIGN_IN_REQUIRED_BODY,
} from '@cribstop/property-contracts';
import type { IntrospectionClient } from '../inquiries/account-introspection';
import type { ReadPool } from '../listings/repository';
import { authenticate, PRIVATE_CACHE_CONTROL } from '../saved/identity';
import { deleteLookingFor, listLookingFor, upsertLookingFor } from './store';

/**
 * The "What I'm looking for" resource of the Property API (#768). It follows `src/saved/`: the
 * account id comes from account-service's introspection, never from the request. Every statement is
 * scoped to that account. Every response is `private, no-store`. A preference sends no email.
 */

const UNAVAILABLE = {
  error: { code: 'unavailable', message: 'Preferences are briefly unavailable. Try again.' },
} as const;

/** Mirrors `saved/routes.ts`: Express 4 does not await handlers. */
const asyncRoute =
  (handler: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next);
  };

/** A client in a zone behind UTC can pick a local "today" that is yesterday in UTC. */
function earliestStart(now: Date): string {
  return new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export interface LookingForRouterDeps {
  pool: ReadPool;
  introspection: IntrospectionClient;
  /** Test seam. */
  now?: () => Date;
}

export function createLookingForRouter(deps: LookingForRouterDeps): Router {
  const router = Router();
  const { pool, introspection } = deps;
  const now = deps.now ?? (() => new Date());

  async function requireAccount(req: Request, res: Response): Promise<string | null> {
    res.set('Cache-Control', PRIVATE_CACHE_CONTROL);
    const outcome = await authenticate(introspection, req);
    if (outcome.kind === 'account') return outcome.accountId;
    if (outcome.kind === 'unavailable') {
      res.set('Retry-After', '2').status(503).json(UNAVAILABLE);
    } else {
      res.status(401).json(SIGN_IN_REQUIRED_BODY);
    }
    return null;
  }

  function invalid(res: Response, fields: string[]): void {
    const body: LookingForInvalidBody = {
      error: {
        code: 'invalid_request',
        message: `Invalid field(s): ${fields.join(', ')}.`,
        fields,
      },
    };
    res.status(400).json(body);
  }

  router.get(
    '/looking-for',
    asyncRoute(async (req, res) => {
      const accountId = await requireAccount(req, res);
      if (accountId === null) return;
      const body: LookingForList = {
        items: await listLookingFor(pool, accountId),
        max: LOOKING_FOR_MAX_PER_ACCOUNT,
      };
      res.status(200).json(body);
    }),
  );

  router.put(
    '/looking-for/:id',
    asyncRoute(async (req, res) => {
      const accountId = await requireAccount(req, res);
      if (accountId === null) return;
      const id = idSchema.safeParse(req.params.id);
      if (!id.success) return invalid(res, ['id']);
      const parsed = lookingForRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        const fields = new Set<string>();
        for (const issue of parsed.error.issues) {
          if (issue.code === 'unrecognized_keys') {
            for (const key of issue.keys) fields.add(key);
          } else {
            fields.add(issue.path.length > 0 ? String(issue.path[0]) : 'body');
          }
        }
        return invalid(res, [...fields]);
      }
      if (parsed.data.whenStart != null && parsed.data.whenStart < earliestStart(now())) {
        return invalid(res, ['whenStart']);
      }
      const outcome = await upsertLookingFor(pool, accountId, id.data.toLowerCase(), parsed.data);
      if (outcome.kind === 'limit_reached') {
        res.status(409).json(LOOKING_FOR_LIMIT_BODY);
        return;
      }
      res.status(outcome.kind === 'created' ? 201 : 200).json(outcome.item);
    }),
  );

  router.delete(
    '/looking-for/:id',
    asyncRoute(async (req, res) => {
      const accountId = await requireAccount(req, res);
      if (accountId === null) return;
      const id = idSchema.safeParse(req.params.id);
      if (!id.success) return invalid(res, ['id']);
      await deleteLookingFor(pool, accountId, id.data.toLowerCase());
      res.status(204).end();
    }),
  );

  return router;
}
