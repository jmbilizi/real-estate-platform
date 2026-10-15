import { type NextFunction, type Request, type Response, Router } from 'express';
import {
  analyticsAccountLinkRequestSchema,
  type ErrorBody,
  UNAUTHENTICATED_BODY,
  UNAVAILABLE_BODY,
} from '@cribstop/property-contracts';
import type { IntrospectionClient } from '../inquiries/account-introspection';
import type { ReadClient } from '../listings/repository';
import { authenticate, PRIVATE_CACHE_CONTROL } from '../saved/identity';

export interface AccountLinkDeps {
  pool: ReadClient;
  introspection: IntrospectionClient;
  enabled: () => boolean;
}

/**
 * `POST /analytics/account-link` (#827). Links the caller's anonymous id to its account.
 *
 * The caller must hold a session that account-service verifies. A signed-out call writes nothing.
 * The route reads the credential only to resolve the account id. It stores the account id and the
 * anonymous id. `Sec-GPC: 1` and `ANALYTICS_ENABLED=false` make the route store nothing.
 */
export function createAccountLinkRouter(deps: AccountLinkDeps): Router {
  const router = Router();

  router.post(
    '/analytics/account-link',
    (req: Request, res: Response, next: NextFunction): void => {
      res.set('Cache-Control', PRIVATE_CACHE_CONTROL);
      const parsed = analyticsAccountLinkRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        const body: ErrorBody = {
          error: { code: 'invalid_request', message: 'The request is not valid.' },
        };
        res.status(400).json(body);
        return;
      }
      if (!deps.enabled() || req.get('Sec-GPC') === '1') {
        res.status(204).end();
        return;
      }
      authenticate(deps.introspection, req)
        .then(async (outcome) => {
          if (outcome.kind === 'unavailable') {
            res.set('Retry-After', '2').status(503).json(UNAVAILABLE_BODY);
            return;
          }
          if (outcome.kind !== 'account') {
            res.status(401).json(UNAUTHENTICATED_BODY);
            return;
          }
          await deps.pool.query(
            `INSERT INTO analytics_account_links (account_id, anon_id)
             VALUES ($1, $2)
             ON CONFLICT (account_id, anon_id) DO UPDATE SET last_linked_at = now()`,
            [outcome.accountId, parsed.data.anon_id],
          );
          res.status(204).end();
        })
        .catch(next);
    },
  );

  return router;
}
