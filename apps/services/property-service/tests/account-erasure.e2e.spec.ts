import { randomUUID } from 'node:crypto';
import axios from 'axios';
import { closePool, getPool } from '../src/db/pool';
import type { ContactsClient } from '../src/inquiries/account-contacts';
import { changeLeadStatus } from '../src/inquiries/lead-status-write';
import { listLeads, readLeadDetail } from '../src/staff/leads-store';
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

const seededLeads: string[] = [];

async function seedLead(status = 'assigned'): Promise<string> {
  const row = await one<{ id: string }>(
    `INSERT INTO listing_inquiries (listing_id, kind, message, status, account_id)
     VALUES ($1, 'message', 'Hello (e2e)', $3, $2) RETURNING id`,
    [listing, randomUUID(), status],
  );
  if (!row) throw new Error('seed failed');
  seededLeads.push(row.id);
  return row.id;
}

// A sent outbox row with no recipient breaks the down of migration 053 in the migration suites.
afterAll(async () => {
  await pool().query('DELETE FROM listing_inquiries WHERE id = ANY($1::uuid[])', [seededLeads]);
  await closePool();
});

interface ProfileRow {
  account_id: string | null;
  display_name: string;
  licence_number: string;
  licence_states: string[];
  brokerage: string;
  active: boolean;
  deactivated_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const PROFILE_SQL =
  'SELECT account_id, display_name, licence_number, licence_states, brokerage, active, deactivated_at, created_at, updated_at FROM agent_profiles WHERE id = $1';

describeWithKey('account erasure of lead-adjacent tables (#992)', () => {
  it('rejects a call without the key', async () => {
    const res = await axios.delete(`/internal/account/${randomUUID()}/data`, {
      validateStatus: () => true,
    });
    expect(res.status).toBe(401);
  });

  it('removes links and unsent outbox rows, and pseudonymises the agent with two assigned leads', async () => {
    const account = randomUUID();
    const leadOne = await seedLead();
    const leadTwo = await seedLead();
    await pool().query(
      'INSERT INTO analytics_account_links (account_id, anon_id) VALUES ($1, $2)',
      [account, `anon-${account}`],
    );
    const profile = await one<{ id: string }>(
      `INSERT INTO agent_profiles (account_id, display_name, licence_number, licence_states)
       VALUES ($1, 'E2E Agent', 'E2E-1', ARRAY['ZZ']) RETURNING id`,
      [account],
    );
    const profileId = profile?.id ?? '';
    const before = await one<ProfileRow>(PROFILE_SQL, [profileId]);
    for (const lead of [leadOne, leadTwo]) {
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
    }
    for (const state of ['held', 'sent']) {
      await pool().query(
        `INSERT INTO notification_outbox
           (lead_id, event_type, recipient_kind, channel, recipient_account_id, template_key, state)
         VALUES ($1, 'lead.assigned', 'agent', 'email', $2, 'agent-lead-assigned', $3)`,
        [leadOne, account, state],
      );
    }

    const res = await erase(account);
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({
      analyticsAccountLinks: 1,
      notificationOutboxDeleted: 1,
      notificationOutboxAnonymised: 1,
      agentProfilesPseudonymised: 1,
      leadAssignmentsKept: 2,
      leadsReturnedToQueue: 2,
    });

    const links = await pool().query(
      'SELECT 1 FROM analytics_account_links WHERE account_id = $1',
      [account],
    );
    expect(links.rows).toHaveLength(0);
    const outbox = await pool().query<{ state: string; recipient_account_id: string | null }>(
      'SELECT state, recipient_account_id FROM notification_outbox WHERE lead_id = $1',
      [leadOne],
    );
    expect(outbox.rows).toEqual([{ state: 'sent', recipient_account_id: null }]);

    const after = await one<ProfileRow>(PROFILE_SQL, [profileId]);
    expect(after).toMatchObject({
      account_id: null,
      display_name: 'E2E Agent',
      licence_number: 'E2E-1',
      licence_states: ['ZZ'],
      brokerage: before?.brokerage,
      active: false,
    });
    expect(after?.deactivated_at).toBeInstanceOf(Date);
    expect(after?.created_at).toEqual(before?.created_at);
    expect(after?.updated_at).toEqual(before?.updated_at);

    const assignments = await pool().query<{ agent_profile_id: string }>(
      'SELECT agent_profile_id FROM lead_assignments WHERE lead_id = ANY($1::uuid[])',
      [[leadOne, leadTwo]],
    );
    expect(assignments.rows).toEqual([
      { agent_profile_id: profileId },
      { agent_profile_id: profileId },
    ]);
    const events = await pool().query<{ agent_profile_id: string }>(
      'SELECT agent_profile_id FROM lead_status_events WHERE lead_id = ANY($1::uuid[]) AND to_status = $2',
      [[leadOne, leadTwo], 'assigned'],
    );
    expect(events.rows.map((row) => row.agent_profile_id)).toEqual([profileId, profileId]);
    const inquiry = await pool().query('SELECT 1 FROM listing_inquiries WHERE id = $1', [leadOne]);
    expect(inquiry.rows).toHaveLength(1);

    const repeat = await erase(account);
    expect(repeat.status).toBe(200);
    expect(repeat.data).toMatchObject({
      analyticsAccountLinks: 0,
      notificationOutboxDeleted: 0,
      notificationOutboxAnonymised: 0,
      agentProfilesPseudonymised: 0,
      leadAssignmentsKept: 0,
      leadsReturnedToQueue: 0,
    });
    expect(await one<ProfileRow>(PROFILE_SQL, [profileId])).toEqual(after);
  });

  it('returns assigned and accepted leads to verified and flags a touring lead (#1007)', async () => {
    const account = randomUUID();
    const profile = await one<{ id: string }>(
      `INSERT INTO agent_profiles (account_id, display_name, licence_number, licence_states)
       VALUES ($1, 'E2E Agent', 'E2E-4', ARRAY['ZZ']) RETURNING id`,
      [account],
    );
    const profileId = profile?.id ?? '';
    const leads = {
      assigned: await seedLead('assigned'),
      accepted: await seedLead('accepted'),
      touring: await seedLead('touring'),
      closed: await seedLead('closed'),
    };
    for (const [status, lead] of Object.entries(leads)) {
      const isClosed = status === 'closed';
      await pool().query(
        `INSERT INTO lead_assignments
           (lead_id, agent_profile_id, assigned_by_account_id, ended_at, end_reason)
         VALUES ($1, $2, $3, $4, $5)`,
        [lead, profileId, randomUUID(), isClosed ? new Date() : null, isClosed ? 'closed' : null],
      );
      await pool().query(
        `INSERT INTO lead_status_events (lead_id, from_status, to_status, actor_role, agent_profile_id)
         VALUES ($1, 'verified', $2, 'staff', $3)`,
        [lead, status, profileId],
      );
    }
    const ids = Object.values(leads);
    const EVENTS_SQL = `SELECT id, lead_id, from_status, to_status, actor_account_id, actor_role,
                               note, agent_profile_id, created_at
                          FROM lead_status_events WHERE lead_id = ANY($1::uuid[])
                         ORDER BY created_at, id`;
    const eventsBefore = (await pool().query(EVENTS_SQL, [ids])).rows;

    const res = await erase(account);
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ agentProfilesPseudonymised: 1, leadsReturnedToQueue: 2 });

    const statuses = await pool().query<{ id: string; status: string }>(
      'SELECT id, status FROM listing_inquiries WHERE id = ANY($1::uuid[])',
      [ids],
    );
    const statusOf = (id: string) => statuses.rows.find((row) => row.id === id)?.status;
    expect(statusOf(leads.assigned)).toBe('verified');
    expect(statusOf(leads.accepted)).toBe('verified');
    expect(statusOf(leads.touring)).toBe('touring');
    expect(statusOf(leads.closed)).toBe('closed');

    const eventsAfter = (await pool().query(EVENTS_SQL, [ids])).rows;
    expect(eventsAfter).toHaveLength(eventsBefore.length + 2);
    for (const before of eventsBefore) expect(eventsAfter).toContainEqual(before);
    for (const [lead, from] of [
      [leads.assigned, 'assigned'],
      [leads.accepted, 'accepted'],
    ]) {
      expect(eventsAfter).toContainEqual(
        expect.objectContaining({
          lead_id: lead,
          from_status: from,
          to_status: 'verified',
          actor_account_id: null,
          actor_role: 'system',
          note: 'agent account erased',
          agent_profile_id: profileId,
        }),
      );
    }

    const open = await pool().query<{ lead_id: string }>(
      'SELECT lead_id FROM lead_assignments WHERE lead_id = ANY($1::uuid[]) AND ended_at IS NULL',
      [ids],
    );
    expect(open.rows).toEqual([{ lead_id: leads.touring }]);
    const returned = await pool().query<{ end_reason: string }>(
      'SELECT end_reason FROM lead_assignments WHERE lead_id = ANY($1::uuid[])',
      [[leads.assigned, leads.accepted]],
    );
    expect(returned.rows).toEqual([{ end_reason: 'returned' }, { end_reason: 'returned' }]);

    const contacts: ContactsClient = { lookup: () => Promise.resolve(new Map()) };
    const detail = await readLeadDetail(pool(), contacts, leads.touring, {
      accountId: randomUUID(),
      role: 'Admin',
    });
    expect(detail?.needsReassignment).toBe(true);
    const page = await listLeads(pool(), contacts, {
      filters: { listingId: listing },
      limit: 50,
      cursor: null,
    });
    const flagged = new Map(page.results.map((row) => [row.id, row.needsReassignment]));
    expect(flagged.get(leads.touring)).toBe(true);
    expect(flagged.get(leads.closed)).toBe(false);
    expect(flagged.get(leads.assigned)).toBe(false);

    const repeat = await erase(account);
    expect(repeat.data).toMatchObject({ agentProfilesPseudonymised: 0, leadsReturnedToQueue: 0 });
    expect((await pool().query(EVENTS_SQL, [ids])).rows).toEqual(eventsAfter);
  });

  it('queues no outbox row for an erased buyer on a later status event (#1006)', async () => {
    const buyer = randomUUID();
    const lead = await one<{ id: string }>(
      `INSERT INTO listing_inquiries
         (listing_id, kind, message, status, account_id, consent_to_contact,
          consent_disclosure_text, consent_given_at, consent_text_version, consent_channels)
       VALUES ($1, 'message', 'Hello (e2e)', 'new', $2, true, 'e2e consent', now(), 'v1',
               ARRAY['email']) RETURNING id`,
      [listing, buyer],
    );
    const leadId = lead?.id ?? '';
    seededLeads.push(leadId);
    const countRows = async () =>
      (
        await pool().query('SELECT 1 FROM notification_outbox WHERE recipient_account_id = $1', [
          buyer,
        ])
      ).rows.length;

    const consentBefore = await one(
      'SELECT consent_to_contact, consent_channels FROM listing_inquiries WHERE id = $1',
      [leadId],
    );
    expect((await erase(buyer)).status).toBe(200);

    const change = await changeLeadStatus(pool(), {
      leadId,
      to: 'verified',
      actorAccountId: null,
      actorRole: 'system',
    });
    expect(change).toMatchObject({ ok: true, to: 'verified' });
    expect(await countRows()).toBe(0);

    const repeat = await erase(buyer);
    expect(repeat.status).toBe(200);
    expect(repeat.data).toMatchObject({
      notificationOutboxDeleted: 0,
      notificationOutboxAnonymised: 0,
    });
    const events = await pool().query(
      'SELECT 1 FROM lead_status_events WHERE lead_id = $1 AND to_status = $2',
      [leadId, 'verified'],
    );
    expect(events.rows).toHaveLength(1);
    expect(
      await one(
        'SELECT consent_to_contact, consent_channels FROM listing_inquiries WHERE id = $1',
        [leadId],
      ),
    ).toEqual(consentBefore);
  });

  it('refuses to reactivate a pseudonymised profile', async () => {
    const account = randomUUID();
    const profile = await one<{ id: string }>(
      `INSERT INTO agent_profiles (account_id, display_name, licence_number, licence_states)
       VALUES ($1, 'E2E Agent', 'E2E-3', ARRAY['ZZ']) RETURNING id`,
      [account],
    );
    expect((await erase(account)).status).toBe(200);
    await expect(
      pool().query('UPDATE agent_profiles SET active = true WHERE id = $1', [profile?.id]),
    ).rejects.toThrow(/agent_profiles_pseudonymised_check/);
  });

  it('keeps the audit guards as strict as before', async () => {
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
