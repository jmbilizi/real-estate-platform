import type { Queryable } from '../inquiries/write';

/**
 * Account deletion (#992). Deletes the unsent rows of the recipient. A sent row stays as a record
 * and loses the recipient id. Idempotent. This is the only code that writes the outbox after the
 * insert. `outbox.spec.ts` allows this file by name.
 */
export async function eraseAccountOutbox(
  db: Queryable,
  accountId: string,
): Promise<{ deleted: number; anonymised: number }> {
  const deleted = await db.query<{ id: string }>(
    `DELETE FROM notification_outbox
      WHERE recipient_account_id = $1 AND state <> 'sent' RETURNING id`,
    [accountId],
  );
  const anonymised = await db.query<{ id: string }>(
    `UPDATE notification_outbox SET recipient_account_id = NULL
      WHERE recipient_account_id = $1 AND state = 'sent' RETURNING id`,
    [accountId],
  );
  return { deleted: deleted.rows.length, anonymised: anonymised.rows.length };
}
