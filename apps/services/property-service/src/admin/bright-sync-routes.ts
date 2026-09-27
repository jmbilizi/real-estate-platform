import { createHash, timingSafeEqual } from 'node:crypto';

import { type NextFunction, type Request, type Response, Router } from 'express';

import { SECRET_PLACEHOLDER } from '../jobs/bright-ingest/config';
import { BRIGHT_STATUS_FILTER_LABELS } from '../jobs/bright-map/status';
import {
  getRun,
  listRuns,
  requestRun,
  SYNC_MODES,
  type SyncArea,
  type SyncMode,
  type SyncQueryable,
  type SyncScope,
} from '../jobs/bright-sync/store';

/**
 * The Bright sync admin endpoint (#338). `POST /admin/bright/sync` queues a run for the
 * `bright-sync-worker`. `GET /admin/bright/sync` and `GET /admin/bright/sync/:runId` show runs.
 *
 * Assumption (#338): no user auth or roles exist yet, so a Bearer `BRIGHT_ADMIN_TOKEN` guards it
 * and no gateway route exposes it. Reach it by port-forward. Replace with role auth when account
 * roles ship. An unset token, or the committed placeholder, refuses every request.
 */

const UNAUTHORIZED = {
  error: { code: 'unauthorized', message: 'A valid admin token is required.' },
};

function invalid(message: string) {
  return { error: { code: 'invalid_request', message } };
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/** Constant-time: both sides are hashed to the same length first. */
export function isAuthorized(header: string | undefined, token: string | undefined): boolean {
  if (token === undefined || token.trim() === '' || token === SECRET_PLACEHOLDER) {
    return false;
  }
  const match = /^Bearer (.+)$/.exec(header ?? '');
  if (match === null) {
    return false;
  }
  return timingSafeEqual(digest(match[1] as string), digest(token));
}

const AREA_FIELD = /^[A-Za-z][A-Za-z .'-]{0,59}$/;

function parseArea(value: unknown): SyncArea | string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return 'area must be an object with city, state or zip.';
  }
  const { city, state, zip, ...rest } = value as Record<string, unknown>;
  if (Object.keys(rest).length > 0) return `Unknown area field: ${Object.keys(rest).join(', ')}.`;
  const area: { city?: string; state?: string; zip?: string } = {};
  if (city !== undefined) {
    if (typeof city !== 'string' || !AREA_FIELD.test(city)) return 'area.city is not a place name.';
    area.city = city;
  }
  if (state !== undefined) {
    if (typeof state !== 'string' || !/^[A-Za-z]{2}$/.test(state)) {
      return 'area.state must be a two-letter code.';
    }
    area.state = state.toUpperCase();
  }
  if (zip !== undefined) {
    if (typeof zip !== 'string' || !/^\d{5}$/.test(zip)) return 'area.zip must be five digits.';
    area.zip = zip;
  }
  if (Object.keys(area).length === 0) return 'area needs city, state or zip.';
  return area;
}

/** Validates the POST body. Returns the mode and scope, or an error message. */
export function parseSyncRequest(
  body: unknown,
): { ok: true; mode: SyncMode; scope: SyncScope } | { ok: false; message: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, message: 'The body must be a JSON object.' };
  }
  const { mode, statuses, area, ...rest } = body as Record<string, unknown>;
  if (Object.keys(rest).length > 0) {
    return { ok: false, message: `Unknown field: ${Object.keys(rest).join(', ')}.` };
  }
  if (typeof mode !== 'string' || !(SYNC_MODES as readonly string[]).includes(mode)) {
    return { ok: false, message: `mode must be one of ${SYNC_MODES.join(', ')}.` };
  }
  const scope: { statuses?: string[]; area?: SyncArea } = {};
  if (statuses !== undefined) {
    const known = Object.keys(BRIGHT_STATUS_FILTER_LABELS);
    if (
      !Array.isArray(statuses) ||
      statuses.length === 0 ||
      !statuses.every((s) => typeof s === 'string' && known.includes(s))
    ) {
      return { ok: false, message: `statuses must be a non-empty list of ${known.join(', ')}.` };
    }
    if (mode === 'incremental') {
      return { ok: false, message: 'An incremental run covers every status. Omit statuses.' };
    }
    scope.statuses = statuses as string[];
  }
  if (area !== undefined) {
    if (mode !== 'backfill' && mode !== 'audit') {
      return { ok: false, message: 'area applies to backfill and audit only.' };
    }
    const parsed = parseArea(area);
    if (typeof parsed === 'string') return { ok: false, message: parsed };
    scope.area = parsed;
  }
  return { ok: true, mode: mode as SyncMode, scope };
}

const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const asyncRoute =
  (handler: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next);
  };

export function createBrightSyncAdminRouter(
  client: SyncQueryable,
  token: () => string | undefined = () => process.env.BRIGHT_ADMIN_TOKEN,
): Router {
  const router = Router();

  router.use('/admin/bright/sync', (req, res, next) => {
    if (!isAuthorized(req.header('authorization'), token())) {
      res.status(401).set('Cache-Control', 'no-store').json(UNAUTHORIZED);
      return;
    }
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.post(
    '/admin/bright/sync',
    asyncRoute(async (req, res) => {
      const parsed = parseSyncRequest(req.body);
      if (!parsed.ok) {
        res.status(400).json(invalid(parsed.message));
        return;
      }
      const run = await requestRun(client, parsed.mode, parsed.scope, 'admin-api');
      res.status(202).json({ runId: run.id, run });
    }),
  );

  router.get(
    '/admin/bright/sync',
    asyncRoute(async (_req, res) => {
      res.status(200).json({ runs: await listRuns(client, 50) });
    }),
  );

  router.get(
    '/admin/bright/sync/:runId',
    asyncRoute(async (req, res) => {
      const runId = req.params.runId ?? '';
      const run = RUN_ID.test(runId) ? await getRun(client, runId) : null;
      if (run === null) {
        res.status(404).json({ error: { code: 'not_found', message: 'No such run.' } });
        return;
      }
      res.status(200).json({ run });
    }),
  );

  return router;
}
