import { type NextFunction, type Request, type Response, Router } from 'express';
import {
  analyticsEventBatchSchema,
  analyticsEventRequestSchema,
  type ErrorBody,
  normalizeAnalyticsEvent,
} from '@cribstop/property-contracts';
import type { ReadClient } from '../listings/repository';
import { type AnalyticsSink, createSinks, fanOut } from './sink';
import { startPopularityRefreshTimer } from './popularity';

/**
 * `POST /analytics/events` (#725, #824). Cookieless event counting.
 *
 * The handler reads the parsed body and the `Sec-GPC` header. It never reads the IP or the user
 * agent, so neither can reach the store. `Sec-GPC: 1` makes the route accept the call and store
 * nothing. The server stamps the time. `ANALYTICS_ENABLED=false` makes
 * the route accept the call and store nothing.
 */

export const RAW_RETENTION_MONTHS = 13;
export const ZERO_RESULT_TEXT_RETENTION_DAYS = 30;
const ZERO_RESULT_EVENT = 'search_zero_result_text';
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

const PURGE_BATCH = 5000;

/**
 * Deletes raw rows past retention: zero-result text after 30 days, every other row after 13 months.
 * The daily count for a row is written when the row is, in the same statement. So the aggregate
 * always exists before the purge deletes the row. Batches keep each statement inside the analytics
 * pool's 1 s statement timeout.
 */
export async function purgeRawAnalyticsEvents(db: ReadClient): Promise<void> {
  const rules = [
    {
      where: `event = '${ZERO_RESULT_EVENT}' AND occurred_at < now() - make_interval(days => $1::int)`,
      age: ZERO_RESULT_TEXT_RETENTION_DAYS,
    },
    {
      where: 'occurred_at < now() - make_interval(months => $1::int)',
      age: RAW_RETENTION_MONTHS,
    },
  ];
  for (const { where, age } of rules) {
    for (;;) {
      const { rows } = await db.query<{ id: string }>(
        `DELETE FROM analytics_events WHERE id IN (
           SELECT id FROM analytics_events WHERE ${where} LIMIT $2
         ) RETURNING id`,
        [age, PURGE_BATCH],
      );
      if (rows.length < PURGE_BATCH) break;
    }
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
  /** The first sink is the system of record. Defaults to the database sink. */
  sinks?: AnalyticsSink[];
}

export function createAnalyticsRouter(deps: AnalyticsRouterDeps): Router {
  const router = Router();
  const enabled = deps.enabled ?? (() => analyticsEnabled());
  const sink = fanOut(deps.sinks ?? createSinks(deps.pool));
  let inFlight = 0;
  // A timer, not a per-write check, so an idle pod still deletes rows older than the retention window.
  startPurgeTimer(deps.pool);
  startPopularityRefreshTimer();

  router.post('/analytics/events', (req: Request, res: Response, next: NextFunction): void => {
    res.set('Cache-Control', 'no-store');
    // The one header the route reads is Sec-GPC. A visitor who sends it has opted out.
    const optedOut = req.get('Sec-GPC') === '1';
    const batch = Array.isArray(req.body);
    const parsed = batch
      ? analyticsEventBatchSchema.safeParse(req.body)
      : analyticsEventRequestSchema.safeParse(req.body);
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
    if (!enabled() || optedOut) {
      res.status(204).end();
      return;
    }
    if (inFlight >= MAX_IN_FLIGHT) {
      console.warn('Analytics event dropped: too many in flight.');
      res.status(204).end();
      return;
    }
    inFlight += 1;
    const events = (Array.isArray(parsed.data) ? parsed.data : [parsed.data]).map(
      normalizeAnalyticsEvent,
    );
    events
      .reduce<Promise<void>>(
        (done, event) => done.then(() => sink.record(event)),
        Promise.resolve(),
      )
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
