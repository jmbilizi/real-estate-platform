import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { closePool, getPool } from '../src/db/pool';
import { complianceFixtureIds } from './support/fixture-ids';

/**
 * Migration 1785801600053 (#691) against a REAL database. The suite rolls this migration back,
 * seeds the old shape, migrates up, and reads the new shape.
 */
const MIGRATION = '1785801600053_leads-contact-from-account';
const migrationsDir = path.join(__dirname, '..', 'migrations');
const listing = complianceFixtureIds().sampleListingId;
const pool = () => getPool();

function steps(): number {
  const names = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => name.replace(/\.js$/, ''))
    .sort();
  const index = names.indexOf(MIGRATION);
  if (index < 0) throw new Error(`${MIGRATION} not found`);
  return names.length - index;
}

/** Runs the node-pg-migrate CLI, like the `migrate` target. The package is ESM and Jest cannot load it. */
function migrate(direction: 'up' | 'down'): void {
  const bin = path.join(
    __dirname,
    '..',
    'node_modules',
    'node-pg-migrate',
    'bin',
    'node-pg-migrate.js',
  );
  execFileSync(process.execPath, [bin, direction, String(steps())], {
    cwd: path.join(__dirname, '..'),
    env: process.env,
    stdio: 'pipe',
  });
}

const columnsOf = async (table: string): Promise<string[]> =>
  (
    await pool().query<{ column_name: string }>(
      'SELECT column_name FROM information_schema.columns WHERE table_name = $1',
      [table],
    )
  ).rows.map((r) => r.column_name);

afterAll(async () => {
  await closePool();
});

describe('migration 053: leads keep only the account id (#691)', () => {
  // A failed test must not leave the shared database rolled back.
  afterEach(() => {
    migrate('up');
  });

  it('drops name, email and verified_account, and keeps phone, message, consent and account_id', async () => {
    const columns = await columnsOf('listing_inquiries');
    for (const dropped of ['name', 'email', 'verified_account']) {
      expect(columns).not.toContain(dropped);
    }
    expect(columns).toEqual(
      expect.arrayContaining([
        'account_id',
        'phone',
        'message',
        'consent_to_contact',
        'consent_disclosure_text',
        'consent_channels',
      ]),
    );
    const outbox = await columnsOf('notification_outbox');
    expect(outbox).toContain('recipient_account_id');
    expect(outbox).not.toContain('recipient_ref');
    expect(outbox).not.toContain('recipient_ref_type');
  });

  it('maps outbox recipients to account ids, for a lead row and an agent profile row', async () => {
    migrate('down');
    const account = randomUUID();
    const agentAccount = randomUUID();
    const lead = await pool().query<{ id: string }>(
      `INSERT INTO listing_inquiries (listing_id, kind, name, email, message, account_id)
       VALUES ($1, 'message', 'E2E Migration', 'old@e2e.example.com', 'Hello (e2e)', $2)
       RETURNING id`,
      [listing, account],
    );
    const leadId = lead.rows[0]?.id;
    const profile = await pool().query<{ id: string }>(
      `INSERT INTO agent_profiles (account_id, display_name, licence_number, licence_states)
       VALUES ($1, 'E2E Agent', 'E2E-2', ARRAY['MD']) RETURNING id`,
      [agentAccount],
    );
    await pool().query(
      `INSERT INTO notification_outbox
         (lead_id, event_type, recipient_kind, channel, recipient_ref, recipient_ref_type,
          template_key)
       VALUES ($1, 'lead.received', 'buyer', 'email', $1, 'lead', 'k'),
              ($1, 'lead.assigned', 'agent', 'email', $2, 'agent_profile', 'k')`,
      [leadId, profile.rows[0]?.id],
    );

    migrate('up');

    const { rows } = await pool().query<{ recipient_kind: string; recipient_account_id: string }>(
      `SELECT recipient_kind, recipient_account_id FROM notification_outbox
        WHERE lead_id = $1 ORDER BY recipient_kind`,
      [leadId],
    );
    expect(rows).toEqual([
      { recipient_kind: 'agent', recipient_account_id: agentAccount },
      { recipient_kind: 'buyer', recipient_account_id: account },
    ]);
  });
});
