import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { LEAD_STATUSES } from '@cribstop/property-contracts';
import { enqueueLeadNotifications, outboxEventFor } from './outbox';

describe('outboxEventFor', () => {
  it('notifies on verify (from new), assign and accept only', () => {
    const events = LEAD_STATUSES.flatMap((from) =>
      LEAD_STATUSES.map((to) => outboxEventFor(from, to)),
    ).filter((e) => e !== null);
    expect(new Set(events)).toEqual(new Set(['lead.verified', 'lead.assigned', 'lead.accepted']));
    expect(outboxEventFor('new', 'verified')).toBe('lead.verified');
    expect(outboxEventFor('assigned', 'verified')).toBeNull();
    expect(outboxEventFor('accepted', 'contacted')).toBeNull();
  });
});

describe('enqueueLeadNotifications', () => {
  function run(event: Parameters<typeof enqueueLeadNotifications>[1]['event'], agent?: string) {
    const calls: { sql: string; params: unknown[] }[] = [];
    const client = {
      query: (sql: string, params: unknown[]) => {
        calls.push({ sql, params });
        return Promise.resolve({ rows: [] });
      },
    } as never;
    return enqueueLeadNotifications(client, {
      leadId: 'lead-1',
      event,
      agentProfileId: agent,
    }).then(() => calls);
  }

  it('gates the buyer row on email consent and copies no contact data', async () => {
    const [buyer] = await run('lead.verified');
    expect(buyer?.sql).toMatch(/consent_to_contact AND 'email' = ANY\(consent_channels\)/);
    expect(JSON.parse(buyer?.params[3] as string)).toEqual({ leadId: 'lead-1' });
  });

  it('writes an agent row only on assignment', async () => {
    expect(await run('lead.accepted', 'agent-1')).toHaveLength(1);
    expect(await run('lead.assigned')).toHaveLength(1);
    const calls = await run('lead.assigned', 'agent-1');
    expect(calls).toHaveLength(2);
    expect(calls[1]?.params[2]).toBe('agent-1');
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.ts$/.test(name) && !/\.spec\.ts$/.test(name) ? [path] : [];
  });
}

describe('the outbox has no sender (#638)', () => {
  const files = sourceFiles(join(__dirname, '..'));

  it('no source file updates or deletes a notification_outbox row', () => {
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      expect(`${file}: ${/(UPDATE|DELETE\s+FROM)\s+notification_outbox/i.test(text)}`).toBe(
        `${file}: false`,
      );
    }
  });

  it('no source file reads the outbox or calls a mail provider', () => {
    const banned = /(FROM\s+notification_outbox|postmark|sendgrid|nodemailer|twilio)/i;
    for (const file of files) {
      expect(`${file}: ${banned.test(readFileSync(file, 'utf8'))}`).toBe(`${file}: false`);
    }
  });
});
