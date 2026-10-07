import { type NextFunction, type Request, type Response, Router } from 'express';
import {
  SIGN_IN_REQUIRED_BODY,
  type StaffMe,
  UNAVAILABLE_BODY,
} from '@cribstop/property-contracts';
import type { IntrospectionClient } from '../inquiries/account-introspection';
import { authenticate, PRIVATE_CACHE_CONTROL } from '../saved/identity';

export interface StaffRouterDeps {
  introspection: IntrospectionClient;
}

/**
 * `GET /staff/me` (#628): the caller's roles, and nothing else. It needs a valid credential, not a
 * role, so the web app can ask "what may this account do" for any signed-in account.
 */
export function createStaffRouter(deps: StaffRouterDeps): Router {
  const router = Router();

  router.get('/staff/me', (req: Request, res: Response, next: NextFunction) => {
    res.set('Cache-Control', PRIVATE_CACHE_CONTROL);
    authenticate(deps.introspection, req)
      .then((outcome) => {
        if (outcome.kind === 'account') {
          const body: StaffMe = { roles: [...outcome.roles] };
          res.status(200).json(body);
        } else if (outcome.kind === 'unavailable') {
          res.set('Retry-After', '2').status(503).json(UNAVAILABLE_BODY);
        } else {
          res.status(401).json(SIGN_IN_REQUIRED_BODY);
        }
      })
      .catch(next);
  });

  return router;
}
