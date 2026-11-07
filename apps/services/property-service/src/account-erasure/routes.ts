import { createHash, timingSafeEqual } from 'node:crypto';

import { type NextFunction, type Request, type Response, Router } from 'express';

import { eraseAccountAnalyticsLinks } from '../analytics/account-link';
import type { ReadClient } from '../listings/repository';
import { eraseAccountLookingFor } from '../looking-for/store';
import { eraseAccountSavedHomes } from '../saved/store';
import { eraseAccountAgent } from '../staff/agents-store';
import { eraseAccountOutbox } from './outbox-erasure';

/**
 * `DELETE /internal/account/:accountId/data` (#803, #992). account-service calls it after an
 * account deletion. It removes the account's `saved_homes`, `looking_for_preferences` and
 * `analytics_account_links` rows, deletes its agent profile, and deletes its unsent
 * `notification_outbox` rows. Sent outbox rows and lead assignment and status rows lose the
 * account's reference and stay.
 *
 * Retained by PRD §6.4, not touched here: `listing_inquiries`, lead notes and lead audit
 * (`lead_status_events`). They record a regulated lead history.
 *
 * In-cluster only: no gateway route reaches `/internal` (`InternalRoutesNotExposedTests`) and the
 * document at `/openapi.json` does not list it. The `X-Internal-Key` header carries the same
 * shared secret as account-service's own internal endpoints (`ACCOUNT_SERVICE_INTERNAL_KEY`).
 * No usable key means every call gets 401.
 *
 * The call is idempotent: an account with no rows, or a repeat call, answers 200 with zero counts.
 */

export const INTERNAL_KEY_HEADER = 'x-internal-key';
export const INTERNAL_KEY_VARIABLE = 'ACCOUNT_SERVICE_INTERNAL_KEY';
const MINIMUM_KEY_LENGTH = 32;

const ACCOUNT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const UNAUTHORIZED = {
  error: { code: 'unauthorized', message: 'A valid internal key is required.' },
};

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/** Constant time: both sides are hashed to one length first. */
export function isInternalKeyValid(presented: string | undefined, key: string | undefined) {
  if (key === undefined || key.length < MINIMUM_KEY_LENGTH || !presented) return false;
  return timingSafeEqual(digest(presented), digest(key));
}

export interface AccountErasureDeps {
  pool: ReadClient;
  /** Defaults to reading `ACCOUNT_SERVICE_INTERNAL_KEY` per request. */
  internalKey?: () => string | undefined;
}

export function createAccountErasureRouter(deps: AccountErasureDeps): Router {
  const router = Router();
  const readKey = deps.internalKey ?? (() => process.env[INTERNAL_KEY_VARIABLE]);

  router.delete(
    '/internal/account/:accountId/data',
    (req: Request, res: Response, next: NextFunction): void => {
      res.set('Cache-Control', 'no-store');
      if (!isInternalKeyValid(req.get(INTERNAL_KEY_HEADER), readKey())) {
        res.status(401).json(UNAUTHORIZED);
        return;
      }
      const accountId = req.params['accountId'] ?? '';
      if (!ACCOUNT_ID_PATTERN.test(accountId)) {
        res
          .status(400)
          .json({ error: { code: 'invalid_request', message: 'accountId is not a UUID.' } });
        return;
      }
      Promise.all([
        eraseAccountSavedHomes(deps.pool, accountId),
        eraseAccountLookingFor(deps.pool, accountId),
        eraseAccountAnalyticsLinks(deps.pool, accountId),
        eraseAccountOutbox(deps.pool, accountId),
        eraseAccountAgent(deps.pool, accountId),
      ])
        .then(([savedHomes, lookingForPreferences, analyticsLinks, outbox, agent]) => {
          res.status(200).json({
            savedHomes,
            lookingForPreferences,
            analyticsAccountLinks: analyticsLinks,
            notificationOutboxDeleted: outbox.deleted,
            notificationOutboxAnonymised: outbox.anonymised,
            ...agent,
          });
        })
        .catch(next);
    },
  );

  return router;
}
