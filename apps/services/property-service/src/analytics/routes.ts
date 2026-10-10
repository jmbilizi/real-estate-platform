import { type NextFunction, type Request, type Response, Router } from 'express';
import {
  type AnalyticsEventRequest,
  analyticsEventRequestSchema,
  type ErrorBody,
} from '@cribstop/property-contracts';
import type { ReadClient } from '../listings/repository';

/**
 * `POST /analytics/events` (#725). Cookieless funnel counting.
 *
 * The handler reads only the parsed body. It never reads a header, the IP or the user agent, so
 * none of them can reach the store. The server stamps the time. `ANALYTICS_ENABLED=false` makes
 * the route accept the call and store nothing.
 */

export const RAW_RETENTION_DAYS = 30;
/** The purge runs at most this often per process. A DELETE on every write would cost more than it saves. */
const PURGE_INTERVAL_MS = 60 * 60 * 1000;

/** Events in flight at once. Past this the route drops the event and answers 204, so a burst never queues without bound. */
const MAX_IN_FLIGHT = 50;

const invalidRequest = (message: string): ErrorBody => ({
  error: { code: 'invalid_request', message },
});

/** A name that is safe to echo: an unknown key is caller-controlled. */
function safeName(name: string): string {
  const trimmed = name.slice(0, 40);
  return /^[A-Za-z0-9_.-]+$/.test(trimmed) ? trimmed : '(unnamed)';
}

export function analyticsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.ANALYTICS_ENABLED ?? 'true').trim().toLowerCase() !== 'false';
}

export async function recordAnalyticsEvent(
  db: ReadClient,
  event: AnalyticsEventRequest,
): Promise<void> {
  // One statement, so the raw row and the daily count commit together or not at all.
  await db.query(
    `WITH raw AS (
       INSERT INTO analytics_events (event, surface, listing_id, session_id)
       VALUES ($1, $2, $3, $4)
     )
     INSERT INTO analytics_daily (day, event, surface, count)
     VALUES ((now() AT TIME ZONE 'UTC')::date, $1, $2, 1)
     ON CONFLICT (day, event, surface) DO UPDATE SET count = analytics_daily.count + 1`,
    [event.event, event.surface, event.listingId ?? null, event.sessionId],
  );
}

const PURGE_BATCH = 5000;

/** Deletes in batches, so each statement stays inside the analytics pool's 1 s statement timeout. */
export async function purgeRawAnalyticsEvents(db: ReadClient): Promise<void> {
  for (;;) {
    const { rows } = await db.query<{ id: string }>(
      `DELETE FROM analytics_events WHERE id IN (
         SELECT id FROM analytics_events
         WHERE occurred_at < now() - make_interval(days => $1::int) LIMIT $2
       ) RETURNING id`,
      [RAW_RETENTION_DAYS, PURGE_BATCH],
    );
    if (rows.length < PURGE_BATCH) return;
  }
}

let purgeTimerStarted = false;

function startPurgeTimer(db: ReadClient): void {
  if (purgeTimerStarted) return;
  purgeTimerStarted = true;
  const run = (): void => {
    purgeRawAnalyticsEvents(db).catch((error: unknown) => {
      console.error('Analytics purge failed:', error);
    });
  };
  // The first run is soon after start, so a pod that restarts often still purges.
  setTimeout(run, 30_000).unref();
  setInterval(run, PURGE_INTERVAL_MS).unref();
}

export interface AnalyticsRouterDeps {
  pool: ReadClient;
  /** Read per request so a test or an operator can switch it without a new router. */
  enabled?: () => boolean;
}

export function createAnalyticsRouter(deps: AnalyticsRouterDeps): Router {
  const router = Router();
  const enabled = deps.enabled ?? (() => analyticsEnabled());
  let inFlight = 0;
  // A timer, not a per-write check, so an idle pod still deletes rows older than 30 days.
  startPurgeTimer(deps.pool);

  router.post('/analytics/events', (req: Request, res: Response, next: NextFunction): void => {
    res.set('Cache-Control', 'no-store');
    const parsed = analyticsEventRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      const unknown = new Set<string>();
      for (const issue of parsed.error.issues) {
        if (issue.code === 'unrecognized_keys') {
          for (const key of issue.keys) unknown.add(safeName(key));
        }
      }
      res
        .status(400)
        .json(
          invalidRequest(
            unknown.size > 0
              ? `Unknown field(s): ${[...unknown].join(', ')}.`
              : 'The event is not valid.',
          ),
        );
      return;
    }
    if (!enabled()) {
      res.status(204).end();
      return;
    }
    if (inFlight >= MAX_IN_FLIGHT) {
      console.warn('Analytics event dropped: too many in flight.');
      res.status(204).end();
      return;
    }
    inFlight += 1;
    recordAnalyticsEvent(deps.pool, parsed.data)
      .then(() => {
        res.status(204).end();
      })
      .catch(next)
      .finally(() => {
        inFlight -= 1;
      });
  });

  return router;
}
