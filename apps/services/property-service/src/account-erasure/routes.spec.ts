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

interface Held {
  saved: number;
  looking: number;
  links: number;
  outboxUnsent: number;
  outboxSent: number;
  agentProfiles: number;
  assignments: number;
}

const EMPTY: Held = {
  saved: 0,
  looking: 0,
  links: 0,
  outboxUnsent: 0,
  outboxSent: 0,
  agentProfiles: 0,
  assignments: 0,
};

const ids = (count: number) => Array.from({ length: count }, (_, i) => ({ id: String(i) }));

/** Holds one account's rows. Each erase empties its table, so a repeat call finds none. */
function createPool(initial: Partial<Held>) {
  const recorded: Recorded[] = [];
  const rows: Held = { ...EMPTY, ...initial };
  const take = (key: keyof Held) => {
    const count = rows[key];
    rows[key] = 0;
    return ids(count);
  };
  const query = <T>(sql: string, values: unknown[] = []): Promise<{ rows: T[] }> => {
    recorded.push({ sql, values });
    let result: unknown[];
    if (sql.includes('saved_homes')) result = take('saved');
    else if (sql.includes('looking_for_preferences')) result = take('looking');
    else if (sql.includes('analytics_account_links')) result = take('links');
    else if (sql.includes('INTO erased_accounts')) result = [];
    else if (sql.startsWith('DELETE FROM notification_outbox')) result = take('outboxUnsent');
    else if (sql.startsWith('UPDATE notification_outbox')) result = take('outboxSent');
    else if (sql.includes('agent_profiles')) {
      result = [{ profiles: rows.agentProfiles, assignments: rows.assignments }];
      rows.agentProfiles = 0;
      rows.assignments = 0;
    } else throw new Error(`Unexpected SQL: ${sql}`);
    return Promise.resolve({ rows: result as T[] });
  };
  const pool: ReadPool = {
    query,
    connect: () => Promise.resolve({ query, release: () => undefined }),
  };
  return { pool, recorded, rows };
}

const app = (pool: ReadPool, key: string | undefined = KEY) =>
  createApp({ pool, internalKey: () => key });

const ZERO_COUNTS = {
  savedHomes: 0,
  lookingForPreferences: 0,
  analyticsAccountLinks: 0,
  notificationOutboxDeleted: 0,
  notificationOutboxAnonymised: 0,
  agentProfilesPseudonymised: 0,
  leadAssignmentsKept: 0,
};

describe('DELETE /internal/account/:accountId/data (#803, #992)', () => {
  it('erases every account-keyed table for the account', async () => {
    const { pool, recorded, rows } = createPool({
      saved: 3,
      looking: 2,
      links: 4,
      outboxUnsent: 5,
      outboxSent: 6,
      agentProfiles: 1,
      assignments: 7,
    });
    const response = await request(app(pool)).delete(PATH).set('X-Internal-Key', KEY);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      savedHomes: 3,
      lookingForPreferences: 2,
      analyticsAccountLinks: 4,
      notificationOutboxDeleted: 5,
      notificationOutboxAnonymised: 6,
      agentProfilesPseudonymised: 1,
      leadAssignmentsKept: 7,
    });
    expect(rows).toEqual(EMPTY);
    expect(recorded).toHaveLength(7);
    expect(recorded.every((r) => r.values[0] === ACCOUNT)).toBe(true);
  });

  it('deletes only unsent outbox rows and blanks the recipient on sent rows', async () => {
    const { pool, recorded } = createPool({ outboxUnsent: 1, outboxSent: 1 });
    await request(app(pool)).delete(PATH).set('X-Internal-Key', KEY);

    const outbox = recorded.map((r) => r.sql).filter((sql) => sql.includes('notification_outbox'));
    expect(outbox.find((sql) => sql.startsWith('DELETE'))).toContain("state <> 'sent'");
    expect(outbox.find((sql) => sql.startsWith('UPDATE'))).toContain('recipient_account_id = NULL');
  });

  it('pseudonymises the agent profile and never deletes it', async () => {
    const { pool, recorded } = createPool({ agentProfiles: 1 });
    await request(app(pool)).delete(PATH).set('X-Internal-Key', KEY);

    const sql = recorded.map((r) => r.sql).find((s) => s.includes('agent_profiles')) ?? '';
    expect(sql).toContain('UPDATE agent_profiles');
    expect(sql).toContain('account_id = NULL');
    expect(sql).toContain('deactivated_at = now()');
    expect(sql).not.toMatch(/DELETE FROM agent_profiles|licence_number|display_name/);
  });

  it('never touches a retained table', async () => {
    const { pool, recorded } = createPool({ saved: 1 });
    await request(app(pool)).delete(PATH).set('X-Internal-Key', KEY);

    const sql = recorded.map((r) => r.sql).join('\n');
    expect(sql).not.toMatch(
      /listing_inquiries|lead_notes|lead_status_events|DELETE FROM lead_assignments/,
    );
  });

  it('is idempotent: a repeat call answers 200 with zero counts', async () => {
    const { pool } = createPool({ saved: 1, links: 1, outboxUnsent: 1, agentProfiles: 1 });
    const first = await request(app(pool)).delete(PATH).set('X-Internal-Key', KEY);
    expect(first.body.savedHomes).toBe(1);
    const repeat = await request(app(pool)).delete(PATH).set('X-Internal-Key', KEY);

    expect(repeat.status).toBe(200);
    expect(repeat.body).toEqual(ZERO_COUNTS);
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
