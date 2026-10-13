# Analytics events (#725, #824)

The web app posts events to `POST /api/events`. The route forwards them to property-service through
the gateway at `/property/analytics/events`. One contract defines every event:
`libs/property-contracts/src/analytics-event.ts`. The contract names no analytics tool.

## Add an event in 3 steps

1. Add one entry to `EVENT_PROPS` in `analytics-event.ts`. List only the properties the event
   accepts. Use an existing property type, or add a strict one. No property may hold free text, a
   name, an email or a phone number.
2. Add the event to the table in `analytics-event.spec.ts`. Run
   `pnpm exec nx test property-contracts`. Update the OpenAPI snapshot with `-u` and read the diff.
3. Call `trackEvent` in the web app. Do not write a migration. The event-specific values go in the
   `props` column.

Add a property to an existing event in the same file. No migration is needed for that either. A
property that needs its own column or index is the one case that needs a migration. Today the
columns are the common properties, `listing_id`, `row_id` and `query_text`.

## Stored fields

| Table              | Fields                                                                                                                                                                                    | Kept                                   |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `analytics_events` | `occurred_at` (server UTC), `event`, `surface`, `session_id`, `anon_id`, `listing_id`, `row_id`, the common properties, `props` (JSON), `schema_version`, `query_text` (zero-result only) | 13 months. `query_text` rows: 30 days. |
| `analytics_daily`  | `day`, `event`, `surface`, `row_id`, `count`                                                                                                                                              | forever                                |

The service stores no IP address and no user agent. `anon_id` is a random code that the browser
keeps in localStorage and rotates after 13 months. The service stores no account id.

A purge job runs hourly. It deletes zero-result text rows after 30 days and all other raw rows after
13 months. The daily count for a row is written in the same statement as the row, so the aggregate
exists before the purge runs.

## Sinks

The route sends each valid event to a list of sinks (`src/analytics/sink.ts`). The database sink is
the system of record. A second sink for an external tool is one more implementation of
`AnalyticsSink`, added in `createSinks` behind a flag. Its failure never fails the call. No external
sink exists.

## Switch

Set `ANALYTICS_ENABLED=false` on property-service or the web app. The route then stores nothing.

## Daily funnel

```sql
SELECT * FROM analytics_funnel_daily_v ORDER BY day DESC;
```

Columns: `searches`, `detail_views`, `saves`, `requests`, `search_to_view_rate`,
`view_to_request_rate`. A rate is `NULL` when its divisor is zero.

The raw rows give per-session paths for the last 13 months:

```sql
SELECT session_id, array_agg(event ORDER BY occurred_at) FROM analytics_events GROUP BY session_id;
```
