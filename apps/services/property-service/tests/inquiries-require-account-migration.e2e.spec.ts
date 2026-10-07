import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { closePool, getPool } from '../src/db/pool';
import { complianceFixtureIds } from './support/fixture-ids';

/**
 * Migration 1785801600052 (#690) against a REAL database: up and down on a seeded anonymous lead.
 * The suite rolls back this migration and every later one, seeds, then migrates up again.
 */
const MIGRATION = '1785801600052_inquiries-require-account';
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

async function seed(accountId: string | null): Promise<string> {
  const { rows } = await pool().query<{ id: string }>(
    `INSERT INTO listing_inquiries (listing_id, kind, name, email, message, account_id)
     VALUES ($1, 'message', 'E2E Migration', $2, 'Hello (e2e)', $3) RETURNING id`,
    [listing, `${randomUUID()}@e2e.example.com`, accountId],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('seed failed');
  await pool().query(
    `INSERT INTO lead_status_events (lead_id, from_status, to_status, actor_role)
     VALUES ($1, NULL, 'new', 'system')`,
    [id],
  );
  await pool().query(
    `INSERT INTO lead_notes (lead_id, author_account_id, author_role, body)
     VALUES ($1, $2, 'Moderator', 'note')`,
    [id, randomUUID()],
  );
  await pool().query(
    `INSERT INTO lead_access_audit (lead_id, actor_account_id, actor_role)
     VALUES ($1, $2, 'Moderator')`,
    [id, randomUUID()],
  );
  const profile = await pool().query<{ id: string }>(
    `INSERT INTO agent_profiles (account_id, display_name, licence_number, licence_states)
     VALUES ($1, 'E2E Agent', 'E2E-1', ARRAY['MD']) RETURNING id`,
    [randomUUID()],
  );
  await pool().query(
    `INSERT INTO lead_assignments (lead_id, agent_profile_id, assigned_by_account_id)
     VALUES ($1, $2, $3)`,
    [id, profile.rows[0]?.id, randomUUID()],
  );
  await pool().query(
    `INSERT INTO notification_outbox
       (lead_id, event_type, recipient_kind, channel, recipient_ref, recipient_ref_type,
        template_key)
     VALUES ($1, 'lead.received', 'buyer', 'email', $1, 'lead', 'k')`,
    [id],
  );
  return id;
}

const count = async (table: string, leadId: string): Promise<number> =>
  (
    await pool().query(
      `SELECT 1 FROM ${table} WHERE ${table === 'listing_inquiries' ? 'id' : 'lead_id'} = $1`,
      [leadId],
    )
  ).rowCount ?? 0;

afterAll(async () => {
  await closePool();
});

describe('migration 052: inquiries require an account (#690)', () => {
  // A failed test must not leave the shared database rolled back.
  afterEach(() => {
    migrate('up');
  });

  it('deletes anonymous leads with their dependent rows, keeps account leads, and sets NOT NULL', async () => {
    migrate('down');
    const anonymous = await seed(null);
    const owned = await seed(randomUUID());

    migrate('up');

    expect(await count('listing_inquiries', anonymous)).toBe(0);
    for (const table of [
      'lead_status_events',
      'lead_notes',
      'lead_access_audit',
      'lead_assignments',
      'notification_outbox',
    ]) {
      expect(await count(table, anonymous)).toBe(0);
      expect(await count(table, owned)).toBe(1);
    }
    expect(await count('listing_inquiries', owned)).toBe(1);
    await expect(seed(null)).rejects.toThrow(/account_id/);
  });

  it('down restores nullability and restores no data', async () => {
    migrate('down');

    const anonymous = await seed(null);
    expect(await count('listing_inquiries', anonymous)).toBe(1);

    migrate('up');
    expect(await count('listing_inquiries', anonymous)).toBe(0);
  });
});
