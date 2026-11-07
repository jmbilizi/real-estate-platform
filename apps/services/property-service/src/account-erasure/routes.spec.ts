import request from 'supertest';
import { createApp } from '../app';
import type { ReadPool } from '../listings/repository';

const ACCOUNT = '0190a000-0000-7000-8000-00000000000a';
const KEY = 'k'.repeat(40);
const PATH = `/internal/account/${ACCOUNT}/data`;

interface Recorded {
  sql: string;
  values: unknown[];
}

/** Holds one account's rows. A DELETE returns the removed ids, so a repeat returns none. */
function createPool(initial: { saved: number; looking: number }) {
  const recorded: Recorded[] = [];
  const rows = { saved_homes: initial.saved, looking_for_preferences: initial.looking };
  const query = <T>(sql: string, values: unknown[] = []): Promise<{ rows: T[] }> => {
    recorded.push({ sql, values });
    const table = sql.includes('saved_homes') ? 'saved_homes' : 'looking_for_preferences';
    const removed = Array.from({ length: rows[table] }, (_, i) => ({ id: String(i) }));
    rows[table] = 0;
    return Promise.resolve({ rows: removed as T[] });
  };
  const pool: ReadPool = {
    query,
    connect: () => Promise.resolve({ query, release: () => undefined }),
  };
  return { pool, recorded, rows };
}

const app = (pool: ReadPool, key: string | undefined = KEY) =>
  createApp({ pool, internalKey: () => key });

describe('DELETE /internal/account/:accountId/data (#803)', () => {
  it('removes both tables for the account', async () => {
    const { pool, recorded, rows } = createPool({ saved: 3, looking: 2 });
    const response = await request(app(pool)).delete(PATH).set('X-Internal-Key', KEY);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ savedHomes: 3, lookingForPreferences: 2 });
    expect(rows).toEqual({ saved_homes: 0, looking_for_preferences: 0 });
    expect(recorded.map((r) => r.values)).toEqual([[ACCOUNT], [ACCOUNT]]);
  });

  it('is idempotent: a repeat call answers 200 with zero counts', async () => {
    const { pool } = createPool({ saved: 1, looking: 0 });
    await request(app(pool)).delete(PATH).set('X-Internal-Key', KEY);
    const repeat = await request(app(pool)).delete(PATH).set('X-Internal-Key', KEY);

    expect(repeat.status).toBe(200);
    expect(repeat.body).toEqual({ savedHomes: 0, lookingForPreferences: 0 });
  });

  it('answers 401 and touches no row without the key', async () => {
    const { pool, recorded } = createPool({ saved: 1, looking: 1 });
    const response = await request(app(pool)).delete(PATH);

    expect(response.status).toBe(401);
    expect(recorded).toEqual([]);
  });

  it('answers 401 for a wrong key', async () => {
    const { pool, recorded } = createPool({ saved: 1, looking: 1 });
    const response = await request(app(pool)).delete(PATH).set('X-Internal-Key', 'x'.repeat(40));

    expect(response.status).toBe(401);
    expect(recorded).toEqual([]);
  });

  it.each([undefined, '', 'StrongBase64Password'])(
    'answers 401 when the configured key is unusable (%p)',
    async (configured) => {
      const { pool, recorded } = createPool({ saved: 1, looking: 1 });
      const response = await request(app(pool, configured))
        .delete(PATH)
        .set('X-Internal-Key', configured ?? 'anything');

      expect(response.status).toBe(401);
      expect(recorded).toEqual([]);
    },
  );

  it('answers 400 for an id that is not a UUID', async () => {
    const { pool, recorded } = createPool({ saved: 0, looking: 0 });
    const response = await request(app(pool))
      .delete('/internal/account/not-a-uuid/data')
      .set('X-Internal-Key', KEY);

    expect(response.status).toBe(400);
    expect(recorded).toEqual([]);
  });

  it('is absent from the published OpenAPI document', async () => {
    const { pool } = createPool({ saved: 0, looking: 0 });
    const response = await request(app(pool)).get('/openapi.json');

    expect(JSON.stringify(response.body)).not.toContain('/internal');
  });
});
