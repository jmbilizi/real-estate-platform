import { LIVE_STATUSES, sameHomeConditions, VIEW_SUBJECT, type SubjectColumns } from './collapse';

/**
 * #717. The price change of a card, from two stored MLS list prices. Nothing is estimated.
 *
 * Two sources, tried in this order:
 *  1. Same key. The latest `price_change` row of `listing_events` for the shown record. The sync
 *     appends it in `upsertListing` when the key's `list_price` changes.
 *  2. Relist. The `list_price` of an earlier record of the same home (the #716 same-home rule,
 *     same office). The earlier record must be on the market or must have ended within
 *     `RELIST_WINDOW_DAYS` before the shown record's `listed_at`.
 *
 * The result is empty when the seller withholds the price or its history, for the shown record
 * and for the earlier record. The caller decides how long a change stays visible (14 and 90 days
 * in the web app), so a cached response never carries a stale "recent" flag.
 */
export const RELIST_WINDOW_DAYS = 60;

const LIVE_STATUS_SQL = `(${LIVE_STATUSES.map((status) => `'${status}'`).join(', ')})`;

/** The relist predecessor of the shown record: the most recent earlier record of the same home. */
function predecessorLateral(subject: SubjectColumns): string {
  const conditions = [
    ...sameHomeConditions(subject, false),
    'o.price_history_display_allowed',
    'o.list_price > 0',
    `o.listed_at < ${subject.listedAt}`,
    // A record on the market is a sibling in the collapse group. An ended record must have ended
    // inside the window. A taken-down record ends at `deleted_at`, a sold one at `close_date`.
    `(CASE WHEN o.deleted_at IS NULL AND o.consumer_status IN ${LIVE_STATUS_SQL}
        THEN true
        ELSE COALESCE(o.deleted_at, o.close_date::timestamptz, o.status_changed_at, o.last_updated)
             >= ${subject.listedAt} - interval '${RELIST_WINDOW_DAYS} days'
      END)`,
  ];
  return `LEFT JOIN LATERAL (
        SELECT o.id, o.list_price
        FROM listings o
        WHERE ${conditions.join('\n          AND ')}
        ORDER BY o.listed_at DESC, o.id DESC
        LIMIT 1
      ) pr ON true`;
}

/**
 * A `LATERAL` source over the shown record. The columns are `previous_price` and
 * `price_changed_at`, and with `withHistory` also `price_history`: a JSON array of
 * `{ date, price, mls_number }`, oldest first, for the shown record and its predecessor. The caller
 * names the alias and the shown record is `v`.
 */
export function priceChangeLateral(
  withHistory = false,
  subject: SubjectColumns = VIEW_SUBJECT,
): string {
  const history = withHistory
    ? `,
      COALESCE((
        SELECT json_agg(json_build_object(
                 'date', h.at, 'price', h.price::float8, 'mls_number', h.mls_number)
               ORDER BY h.at, h.seq)
        FROM (VALUES (l.id), (pr.id)) AS r(id)
        JOIN listings rec ON rec.id = r.id
        CROSS JOIN LATERAL (
          (SELECT e.occurred_at AS at, e.new_price AS price, 0 AS seq,
                  NULLIF(rec.source_listing_id, rec.source_listing_key) AS mls_number
           FROM listing_events e
           WHERE e.listing_id = rec.id AND e.event_type = 'listed' AND e.new_price IS NOT NULL
           ORDER BY e.occurred_at, e.id
           LIMIT 1)
          UNION ALL
          (SELECT e.occurred_at, e.new_price, 1,
                  NULLIF(rec.source_listing_id, rec.source_listing_key)
           FROM listing_events e
           WHERE e.listing_id = rec.id AND e.event_type = 'price_change'
             AND e.new_price IS NOT NULL)
        ) h
      ), '[]'::json) AS price_history`
    : '';
  return `(
    SELECT
      CASE WHEN sk.id IS NOT NULL THEN sk.old_price::float8
           WHEN pr.list_price <> l.list_price THEN pr.list_price::float8 END AS previous_price,
      CASE WHEN sk.id IS NOT NULL THEN sk.occurred_at
           WHEN pr.list_price <> l.list_price THEN ${subject.listedAt} END AS price_changed_at${history}
    FROM listings l
    LEFT JOIN LATERAL (
      SELECT e.id, e.old_price, e.occurred_at
      FROM listing_events e
      WHERE e.listing_id = l.id AND e.event_type = 'price_change'
        AND e.old_price > 0 AND e.new_price = l.list_price
      ORDER BY e.occurred_at DESC, e.id DESC
      LIMIT 1
    ) sk ON true
    ${predecessorLateral(subject)}
    WHERE l.id = ${subject.id} AND l.price_display_allowed AND l.price_history_display_allowed
      AND ${subject.price} > 0
  )`;
}
