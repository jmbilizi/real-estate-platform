import {
  LOOKING_FOR_MAX_PER_ACCOUNT,
  type LookingFor,
  type LookingForRequest,
} from '@cribstop/property-contracts';
import type { ReadClient, ReadPool } from '../listings/repository';

/**
 * THE ONLY MODULE THAT TOUCHES `looking_for_preferences` (#768). Every statement is scoped by
 * `account_id`, so no caller reads or changes another account's rows.
 */

interface Row {
  id: string;
  intent: 'buy' | 'rent';
  places: LookingFor['places'];
  price_min: number | null;
  price_max: number | null;
  beds_min: number | null;
  baths_min: number | null;
  home_types: LookingFor['homeTypes'];
  when_start: string | null;
  when_end: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

const COLUMNS = `id, intent, places, price_min, price_max, beds_min, baths_min, home_types,
  to_char(when_start, 'YYYY-MM-DD') AS when_start, to_char(when_end, 'YYYY-MM-DD') AS when_end,
  created_at, updated_at`;

const iso = (value: Date | string): string => new Date(value).toISOString();

function toItem(row: Row): LookingFor {
  return {
    id: row.id,
    intent: row.intent,
    places: row.places,
    priceMin: row.price_min,
    priceMax: row.price_max,
    bedsMin: row.beds_min,
    bathsMin: row.baths_min,
    homeTypes: row.home_types,
    whenStart: row.when_start,
    whenEnd: row.when_end,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

/** The account's preferences, newest change first. */
export async function listLookingFor(db: ReadClient, accountId: string): Promise<LookingFor[]> {
  const result = await db.query<Row>(
    `SELECT ${COLUMNS} FROM looking_for_preferences
      WHERE account_id = $1
      ORDER BY updated_at DESC, id DESC`,
    [accountId],
  );
  return result.rows.map(toItem);
}

/** Idempotent: removing an id that is absent changes nothing. */
export async function deleteLookingFor(
  db: ReadClient,
  accountId: string,
  id: string,
): Promise<void> {
  await db.query('DELETE FROM looking_for_preferences WHERE account_id = $1 AND id = $2', [
    accountId,
    id,
  ]);
}

export type UpsertOutcome =
  | { kind: 'created'; item: LookingFor }
  | { kind: 'replaced'; item: LookingFor }
  | { kind: 'limit_reached' };

/**
 * Creates or replaces one preference. A per-account advisory lock serializes the calls of one
 * account, so the count and the insert cannot interleave and the limit holds under concurrency.
 * A known id replaces the row, even at the limit.
 */
export async function upsertLookingFor(
  pool: ReadPool,
  accountId: string,
  id: string,
  request: LookingForRequest,
): Promise<UpsertOutcome> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`looking_for:${accountId}`]);

    const existing = await client.query<{ id: string }>(
      'SELECT id FROM looking_for_preferences WHERE account_id = $1 AND id = $2',
      [accountId, id],
    );
    const exists = existing.rows.length > 0;
    if (!exists) {
      const count = await client.query<{ count: string }>(
        'SELECT count(*) AS count FROM looking_for_preferences WHERE account_id = $1',
        [accountId],
      );
      if (Number(count.rows[0]?.count ?? 0) >= LOOKING_FOR_MAX_PER_ACCOUNT) {
        await client.query('ROLLBACK');
        return { kind: 'limit_reached' };
      }
    }

    const whenStart = request.whenStart ?? null;
    const values = [
      accountId,
      id,
      request.intent,
      JSON.stringify(request.places),
      request.priceMin ?? null,
      request.priceMax ?? null,
      request.bedsMin ?? null,
      request.bathsMin ?? null,
      request.homeTypes ?? [],
      whenStart,
      whenStart === null ? null : (request.whenEnd ?? null),
    ];
    const saved = await client.query<Row>(
      `INSERT INTO looking_for_preferences
         (account_id, id, intent, places, price_min, price_max, beds_min, baths_min,
          home_types, when_start, when_end)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9::text[], $10::date, $11::date)
       ON CONFLICT (account_id, id) DO UPDATE SET
         intent = EXCLUDED.intent, places = EXCLUDED.places,
         price_min = EXCLUDED.price_min, price_max = EXCLUDED.price_max,
         beds_min = EXCLUDED.beds_min, baths_min = EXCLUDED.baths_min,
         home_types = EXCLUDED.home_types,
         when_start = EXCLUDED.when_start, when_end = EXCLUDED.when_end,
         updated_at = now()
       RETURNING ${COLUMNS}`,
      values,
    );
    await client.query('COMMIT');
    const item = toItem(saved.rows[0] as Row);
    return { kind: exists ? 'replaced' : 'created', item };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
