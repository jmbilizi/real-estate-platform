import type { ReadClient } from '../listings/repository';

/**
 * THE ONLY MODULE THAT TOUCHES `saved_homes` (#23). Every statement is scoped by `account_id`, so
 * no caller can read or change another account's saves.
 *
 * `homeId` is the home id of #386: the unit id in a subdivided building, else the property id. It
 * is the only identity a save has. The listing id is context and no statement reads it back.
 */

export interface SavedHomeDbRow {
  property_id: string;
  listing_id: string | null;
  created_at: Date | string;
}

/** Idempotent: a second save of the same home keeps the first save's time and listing context. */
export async function saveHome(
  db: ReadClient,
  accountId: string,
  homeId: string,
  contextListingId: string | null,
): Promise<void> {
  await db.query(
    `INSERT INTO saved_homes (account_id, property_id, listing_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (account_id, property_id) DO NOTHING`,
    [accountId, homeId, contextListingId],
  );
}

/** Idempotent: removing a home that is not saved changes nothing. */
export async function unsaveHome(db: ReadClient, accountId: string, homeId: string): Promise<void> {
  await db.query('DELETE FROM saved_homes WHERE account_id = $1 AND property_id = $2', [
    accountId,
    homeId,
  ]);
}

/** The ids in `homeIds` that the account saved. Ids come back lower-case. */
export async function findSavedHomeIds(
  db: ReadClient,
  accountId: string,
  homeIds: readonly string[],
): Promise<Set<string>> {
  if (homeIds.length === 0) return new Set();
  const result = await db.query<{ property_id: string }>(
    `SELECT property_id FROM saved_homes
      WHERE account_id = $1 AND property_id = ANY($2::uuid[])`,
    [accountId, homeIds],
  );
  return new Set(result.rows.map((row) => row.property_id));
}

export async function countSavedHomes(db: ReadClient, accountId: string): Promise<number> {
  const result = await db.query<{ count: string }>(
    'SELECT count(*) AS count FROM saved_homes WHERE account_id = $1',
    [accountId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

/** One page of the account's saves, newest first. */
export async function listSavedHomeRows(
  db: ReadClient,
  accountId: string,
  limit: number,
  offset: number,
): Promise<SavedHomeDbRow[]> {
  const result = await db.query<SavedHomeDbRow>(
    `SELECT property_id, listing_id, created_at
       FROM saved_homes
      WHERE account_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT $2 OFFSET $3`,
    [accountId, limit, offset],
  );
  return result.rows;
}
