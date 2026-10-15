import type { NormalizedAnalyticsEvent } from '@cribstop/property-contracts';
import type { ReadClient } from '../listings/repository';

/**
 * Where a validated event goes. The database sink is the system of record. A second sink for an
 * external tool is one more implementation of this interface, added to `createSinks` behind a
 * flag. It never touches the route. No external sink exists yet.
 */
export interface AnalyticsSink {
  record(event: NormalizedAnalyticsEvent): Promise<void>;
}

export function createDbSink(db: ReadClient): AnalyticsSink {
  return {
    async record(event) {
      // One statement, so the raw row and the daily count commit together or not at all.
      await db.query(
        `WITH raw AS (
           INSERT INTO analytics_events
             (event, surface, listing_id, session_id, schema_version, anon_id, path_template, device,
              utm_source, utm_medium, utm_campaign, referrer_host, app_version, row_id, query_text, props)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb)
         )
         INSERT INTO analytics_daily (day, event, surface, row_id, count)
         VALUES ((now() AT TIME ZONE 'UTC')::date, $1, $2, COALESCE($14, ''), 1)
         ON CONFLICT (day, event, surface, row_id) DO UPDATE SET count = analytics_daily.count + 1`,
        [
          event.event,
          event.surface,
          event.listingId,
          event.sessionId,
          event.version,
          event.anonId,
          event.common.path_template ?? null,
          event.common.device ?? null,
          event.common.utm_source ?? null,
          event.common.utm_medium ?? null,
          event.common.utm_campaign ?? null,
          event.common.referrer_host ?? null,
          event.common.app_version ?? null,
          event.rowId,
          event.queryText,
          JSON.stringify(event.props),
        ],
      );
    },
  };
}

/** The first sink is the system of record: its failure fails the call. Later sinks are best effort. */
export function fanOut(sinks: AnalyticsSink[]): AnalyticsSink {
  return {
    async record(event) {
      const [primary, ...rest] = sinks;
      if (!primary) return;
      await primary.record(event);
      await Promise.all(
        rest.map((sink) =>
          sink.record(event).catch((error: unknown) => {
            console.error('Analytics secondary sink failed:', error);
          }),
        ),
      );
    },
  };
}

export function createSinks(db: ReadClient): AnalyticsSink[] {
  return [createDbSink(db)];
}
