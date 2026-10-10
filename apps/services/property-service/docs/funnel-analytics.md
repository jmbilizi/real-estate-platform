# Funnel analytics (#725)

The web app posts four events to `POST /api/events`. The route forwards them to property-service
through the gateway at `/property/analytics/events`.

## Stored fields

| Table              | Fields                                                                     | Kept    |
| ------------------ | -------------------------------------------------------------------------- | ------- |
| `analytics_events` | `occurred_at` (server UTC), `event`, `surface`, `listing_id`, `session_id` | 30 days |
| `analytics_daily`  | `day`, `event`, `surface`, `count`                                         | forever |

Nothing else is stored. The service stores no cookie, IP address, user agent, account id, email,
search word or free text. `session_id` is a random code held in browser tab memory.

Events: `search`, `listing_view`, `listing_save`, `lead_submit`. Surfaces: `search`, `map`,
`detail`, `favorites`.

## Switch

Set `ANALYTICS_ENABLED=false` on property-service or the web app. The route then stores nothing.

## Daily funnel

```sql
SELECT * FROM analytics_funnel_daily_v ORDER BY day DESC;
```

Columns: `searches`, `detail_views`, `saves`, `requests`, `search_to_view_rate`,
`view_to_request_rate`. A rate is `NULL` when its divisor is zero.

The raw rows give per-session paths for the last 30 days:

```sql
SELECT session_id, array_agg(event ORDER BY occurred_at) FROM analytics_events GROUP BY session_id;
```
