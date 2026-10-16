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

## Batches

The body is one event or an array of 1 to 50 events. One bad event rejects the array. Send
impressions in arrays: the gateway allows 120 requests per minute per client.

## Lead and sign-in events (#827)

Each lead step (`lead_open`, `lead_start`, `lead_submit`, `lead_error`) and each sign-in step
(`auth_identify_shown`, `auth_code_sent`, `auth_code_verified`, `auth_signup_done`, `auth_fail`)
records one event per occurrence.

`error_code` is a fixed list: `LEAD_ERROR_CODES` and `AUTH_ERROR_CODES` in
`libs/property-contracts/src/analytics-event.ts`. Add a code there. No event carries an email, a
phone number or a name.

## Account link (#827)

After a verified sign-in, the web app calls `POST /api/analytics/account-link`. The relay forwards
it to `POST /property/analytics/account-link` with the session. The body holds `anon_id` only.

Property service resolves the account from the session. It writes one row per account and anon id to
`analytics_account_links`. A signed-out call writes nothing and answers 401. Account-service stores
no part of the link. `Sec-GPC: 1` and `ANALYTICS_ENABLED=false` store nothing.

## Switch

Set `ANALYTICS_ENABLED=false` on property-service or the web app. The route then stores nothing.

A request with `Sec-GPC: 1` also stores nothing. The web helper `trackEvent` sends nothing when
Global Privacy Control is on or the footer "Personalise my home page" switch is off.

## Daily funnel

```sql
SELECT * FROM analytics_funnel_daily_v ORDER BY day DESC;
```

Columns: `searches`, `detail_views`, `saves`, `requests`, `search_to_view_rate`,
`view_to_request_rate`. A rate is `NULL` when its divisor is zero.

## Session funnel and reach (#828)

`analytics_daily_reach` holds distinct `sessions` and `visitors` per `day` and `event`. The route
timer fills it from the raw rows every hour for the last 3 days
(`refresh_analytics_daily_reach(from_day)`). A day older than 13 months keeps its row.

```sql
SELECT * FROM analytics_funnel_sessions_daily_v ORDER BY day DESC;
```

Columns: sessions per step (`search`, `listing_impression`, `listing_click`, `listing_view`,
`listing_save`, `lead_start`, `lead_submit`) and four step rates. A rate is `NULL` when its divisor
is zero.

## Retention

```sql
SELECT * FROM analytics_retention_weekly_v ORDER BY first_seen_week DESC;
```

A cohort is the visitors (`anon_id`) whose first event falls in one UTC week. A visitor is retained
at D1, D7 or D30 when the visitor has an event exactly that many days after the first-seen day. A
rate is `NULL` until the whole week is old enough. First-seen moves forward when the purge deletes
old raw rows.

The raw rows give per-session paths for the last 13 months:

```sql
SELECT session_id, array_agg(event ORDER BY occurred_at) FROM analytics_events GROUP BY session_id;
```
