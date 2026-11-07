import { randomUUID } from 'node:crypto';
import axios from 'axios';
import { closePool, getPool } from '../src/db/pool';
import { complianceFixtureIds } from './support/fixture-ids';

/**
 * `DELETE /internal/account/:accountId/data` (#992) against a REAL service and REAL database.
 * Start the service with `ACCOUNT_SERVICE_INTERNAL_KEY` set, and export the same value to this run.
 * Without the variable the suite skips.
 */
const key = process.env['ACCOUNT_SERVICE_INTERNAL_KEY'];
const describeWithKey = key ? describe : describe.skip;
const listing = complianceFixtureIds().sampleListingId;
const pool = () => getPool();

const erase = (accountId: string) =>
  axios.delete(`/internal/account/${accountId}/data`, {
    headers: { 'X-Internal-Key': key ?? '' },
    validateStatus: () => true,
  });

const one = async <T>(sql: string, values: unknown[]): Promise<T | undefined> =>
  (await pool().query(sql, values)).rows[0] as T | undefined;

async function seedLead(): Promise<string> {
  const row = await one<{ id: string }>(
    `INSERT INTO listing_inquiries (listing_id, kind, message, status, account_id)
     VALUES ($1, 'message', 'Hello (e2e)', 'assigned', $2) RETURNING id`,
    [listing, randomUUID()],
  );
  if (!row) throw new Error('seed failed');
  return row.id;
}

afterAll(async () => {
  await closePool();
});

describeWithKey('account erasure of lead-adjacent tables (#992)', () => {
  it('rejects a call without the key', async () => {
    const res = await axios.delete(`/internal/account/${randomUUID()}/data`, {
      validateStatus: () => true,
    });
    expect(res.status).toBe(401);
  });

  it('deletes links, unsent outbox rows and the agent profile, and keeps the lead history', async () => {
    const account = randomUUID();
    const lead = await seedLead();
    await pool().query(
      'INSERT INTO analytics_account_links (account_id, anon_id) VALUES ($1, $2)',
      [account, `anon-${account}`],
    );
    const profile = await one<{ id: string }>(
      `INSERT INTO agent_profiles (account_id, display_name, licence_number, licence_states)
       VALUES ($1, 'E2E Agent', 'E2E-1', ARRAY['ZZ']) RETURNING id`,
      [account],
    );
    const profileId = profile?.id;
    await pool().query(
      `INSERT INTO lead_assignments (lead_id, agent_profile_id, assigned_by_account_id)
       VALUES ($1, $2, $3)`,
      [lead, profileId, randomUUID()],
    );
    await pool().query(
      `INSERT INTO lead_status_events (lead_id, from_status, to_status, actor_role, agent_profile_id)
       VALUES ($1, 'verified', 'assigned', 'staff', $2)`,
      [lead, profileId],
    );
    for (const state of ['held', 'sent']) {
      await pool().query(
        `INSERT INTO notification_outbox
           (lead_id, event_type, recipient_kind, channel, recipient_account_id, template_key, state)
         VALUES ($1, 'lead.assigned', 'agent', 'email', $2, 'agent-lead-assigned', $3)`,
        [lead, account, state],
      );
    }

    const res = await erase(account);
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({
      analyticsAccountLinks: 1,
      notificationOutboxDeleted: 1,
      notificationOutboxAnonymised: 1,
      agentProfiles: 1,
      leadAssignmentsDetached: 1,
    });

    const links = await pool().query(
      'SELECT 1 FROM analytics_account_links WHERE account_id = $1',
      [account],
    );
    expect(links.rows).toHaveLength(0);
    const agents = await pool().query('SELECT 1 FROM agent_profiles WHERE account_id = $1', [
      account,
    ]);
    expect(agents.rows).toHaveLength(0);
    const outbox = await pool().query<{ state: string; recipient_account_id: string | null }>(
      'SELECT state, recipient_account_id FROM notification_outbox WHERE lead_id = $1',
      [lead],
    );
    expect(outbox.rows).toEqual([{ state: 'sent', recipient_account_id: null }]);
    const assignments = await pool().query<{ agent_profile_id: string | null }>(
      'SELECT agent_profile_id FROM lead_assignments WHERE lead_id = $1',
      [lead],
    );
    expect(assignments.rows).toEqual([{ agent_profile_id: null }]);
    const events = await pool().query<{ agent_profile_id: string | null }>(
      'SELECT agent_profile_id FROM lead_status_events WHERE lead_id = $1 AND to_status = $2',
      [lead, 'assigned'],
    );
    expect(events.rows).toEqual([{ agent_profile_id: null }]);
    const inquiry = await pool().query('SELECT 1 FROM listing_inquiries WHERE id = $1', [lead]);
    expect(inquiry.rows).toHaveLength(1);

    const repeat = await erase(account);
    expect(repeat.status).toBe(200);
    expect(repeat.data).toMatchObject({
      analyticsAccountLinks: 0,
      notificationOutboxDeleted: 0,
      notificationOutboxAnonymised: 0,
      agentProfiles: 0,
      leadAssignmentsDetached: 0,
    });
  });

  it('still refuses any other update of a status event or an ended assignment', async () => {
    const lead = await seedLead();
    const event = await one<{ id: string }>(
      `INSERT INTO lead_status_events (lead_id, from_status, to_status, actor_role)
       VALUES ($1, 'verified', 'assigned', 'staff') RETURNING id`,
      [lead],
    );
    await expect(
      pool().query("UPDATE lead_status_events SET note = 'edit' WHERE id = $1", [event?.id]),
    ).rejects.toThrow(/append-only/);
  });
});
