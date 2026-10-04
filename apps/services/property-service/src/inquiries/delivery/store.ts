import type { Queryable } from '../write';
import type { InquiryForDelivery } from './message';

/**
 * Every delivery-state transition of `listing_inquiries` (#134). `write.ts` still owns the INSERT.
 * Claims use `FOR UPDATE SKIP LOCKED`, so two replicas never send the same inquiry at once.
 */

export interface ClaimedInquiry extends InquiryForDelivery {
  delivery_attempts: number;
}

/** Marks inquiries on sample listings (#93). They are never sent to intake. Returns the count. */
export async function markSampleInquiries(db: Queryable): Promise<number> {
  const result = await db.query<{ id: string }>(
    `UPDATE listing_inquiries i
        SET delivery_state = 'sample', delivery_claimed_at = NULL
       FROM listings l
       JOIN properties p ON p.id = l.property_id
       LEFT JOIN units u ON u.id = l.unit_id
      WHERE i.listing_id = l.id
        AND i.delivery_state IN ('pending', 'sending')
        AND (l.is_sample OR p.is_sample OR COALESCE(u.is_sample, false))
      RETURNING i.id`,
  );
  return result.rows.length;
}

/** Fails `sending` rows whose worker died and whose attempts are used up. Returns the count. */
export async function failAbandoned(
  db: Queryable,
  options: { leaseMs: number; maxAttempts: number },
): Promise<number> {
  const result = await db.query<{ id: string }>(
    `UPDATE listing_inquiries
        SET delivery_state = 'failed',
            delivery_last_error = 'Worker stopped mid-send and attempts are used up.'
      WHERE delivery_state = 'sending'
        AND delivery_claimed_at < now() - ($1::int * interval '1 millisecond')
        AND delivery_attempts >= $2
      RETURNING id`,
    [options.leaseMs, options.maxAttempts],
  );
  return result.rows.length;
}

/** Claims due rows. A `sending` row past its lease counts as due. */
export async function claimDueInquiries(
  db: Queryable,
  options: { batchSize: number; leaseMs: number },
): Promise<ClaimedInquiry[]> {
  const result = await db.query<ClaimedInquiry>(
    `WITH due AS (
       SELECT id FROM listing_inquiries
        WHERE (delivery_state = 'pending' AND next_attempt_at <= now())
           OR (delivery_state = 'sending'
               AND delivery_claimed_at < now() - ($2::int * interval '1 millisecond'))
        ORDER BY created_at
        LIMIT $1
        FOR UPDATE SKIP LOCKED
     ), claimed AS (
       UPDATE listing_inquiries i
          SET delivery_state = 'sending',
              delivery_attempts = i.delivery_attempts + 1,
              delivery_claimed_at = now()
         FROM due
        WHERE i.id = due.id
        RETURNING i.id, i.listing_id, i.kind, i.name, i.email, i.phone, i.message,
                  i.created_at, i.delivery_attempts
     )
     SELECT c.*, v.address, v.address_display_allowed
       FROM claimed c
       LEFT JOIN listing_search_v v ON v.id = c.listing_id
      ORDER BY c.created_at`,
    [options.batchSize, options.leaseMs],
  );
  return result.rows;
}

export async function recordDelivered(db: Queryable, id: string, messageId: string): Promise<void> {
  await db.query(
    `UPDATE listing_inquiries
        SET delivery_state = 'delivered', delivered_at = now(), delivery_message_id = $2,
            delivery_last_error = NULL, delivery_claimed_at = NULL
      WHERE id = $1 AND delivery_state = 'sending'`,
    [id, messageId],
  );
}

export async function recordRetry(
  db: Queryable,
  id: string,
  error: string,
  backoffMs: number,
): Promise<void> {
  await db.query(
    `UPDATE listing_inquiries
        SET delivery_state = 'pending', delivery_last_error = $2, delivery_claimed_at = NULL,
            next_attempt_at = now() + ($3::int * interval '1 millisecond')
      WHERE id = $1 AND delivery_state = 'sending'`,
    [id, error, backoffMs],
  );
}

export async function recordFailed(db: Queryable, id: string, error: string): Promise<void> {
  await db.query(
    `UPDATE listing_inquiries
        SET delivery_state = 'failed', delivery_last_error = $2, delivery_claimed_at = NULL
      WHERE id = $1 AND delivery_state = 'sending'`,
    [id, error],
  );
}

export interface OverdueSummary {
  count: number;
  oldestAgeSeconds: number;
}

/** Inquiries not `delivered` and older than the age limit. `sample` rows are not undelivered. */
export async function summarizeOverdue(
  db: Queryable,
  overdueAgeMs: number,
): Promise<OverdueSummary> {
  const result = await db.query<{ count: string; oldest_age_seconds: string | null }>(
    `SELECT count(*)::text AS count,
            floor(extract(epoch FROM now() - min(created_at)))::text AS oldest_age_seconds
       FROM listing_inquiries
      WHERE delivery_state IN ('pending', 'sending', 'failed')
        AND created_at < now() - ($1::int * interval '1 millisecond')`,
    [overdueAgeMs],
  );
  const row = result.rows[0];
  return {
    count: Number(row?.count ?? 0),
    oldestAgeSeconds: Number(row?.oldest_age_seconds ?? 0),
  };
}
