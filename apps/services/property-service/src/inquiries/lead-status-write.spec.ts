import { changeLeadStatus, type TransactionalPool } from './lead-status-write';

function fakePool(currentStatus: string | null): {
  pool: TransactionalPool;
  sql: string[];
  params: unknown[][];
  released: () => number;
} {
  const sql: string[] = [];
  const params: unknown[][] = [];
  let released = 0;
  const query = ((text: string, values: unknown[] = []) => {
    sql.push(text);
    params.push(values);
    if (text.startsWith('SELECT status')) {
      return Promise.resolve({ rows: currentStatus === null ? [] : [{ status: currentStatus }] });
    }
    return Promise.resolve({ rows: [] });
  }) as never;
  return {
    pool: {
      connect: () =>
        Promise.resolve({
          query,
          release: () => {
            released += 1;
          },
        }),
    },
    sql,
    params,
    released: () => released,
  };
}

const INPUT = {
  leadId: '018f2f2a-6d1b-7c3d-8b2e-0000000000aa',
  to: 'verified' as const,
  actorAccountId: '018f2f2a-6d1b-7c3d-8b2e-0000000000bb',
  actorRole: 'moderator',
  note: 'Checked the phone number.',
};

describe('changeLeadStatus', () => {
  it('updates the status and appends the event inside one transaction', async () => {
    const { pool, sql, params, released } = fakePool('new');

    const result = await changeLeadStatus(pool, INPUT);

    expect(result).toEqual({ ok: true, from: 'new', to: 'verified' });
    expect(sql[0]).toBe('BEGIN');
    expect(sql[1]).toMatch(/FOR UPDATE/);
    expect(sql[2]).toMatch(/UPDATE lead_assignments SET ended_at/);
    expect(params[2]).toEqual([INPUT.leadId, 'returned']);
    expect(sql[3]).toMatch(/UPDATE listing_inquiries SET status/);
    expect(sql[4]).toMatch(/INSERT INTO lead_status_events/);
    expect(sql[5]).toBe('COMMIT');
    expect(params[4]).toEqual([
      INPUT.leadId,
      'new',
      'verified',
      INPUT.actorAccountId,
      'moderator',
      INPUT.note,
      null,
    ]);
    expect(released()).toBe(1);
  });

  it('runs the precheck inside the transaction and rolls back on a rejection', async () => {
    const { pool, sql } = fakePool('verified');

    const result = await changeLeadStatus(pool, {
      ...INPUT,
      to: 'assigned',
      precheck: () => Promise.resolve('agent_not_licensed'),
    });

    expect(result).toEqual({ ok: false, reason: 'rejected', code: 'agent_not_licensed' });
    expect(sql).toEqual(['BEGIN', expect.stringMatching(/^SELECT status/), 'ROLLBACK']);
  });

  it.each([['lost'], ['closed']] as const)(
    'ends the open assignment when the lead is %s',
    async (to) => {
      const { pool, params, sql } = fakePool(to === 'lost' ? 'assigned' : 'contacted');

      await changeLeadStatus(pool, { ...INPUT, to });

      expect(sql[2]).toMatch(/UPDATE lead_assignments SET ended_at/);
      expect(params[2]).toEqual([INPUT.leadId, 'closed']);
    },
  );

  it('does not end an assignment when the status is not `verified`', async () => {
    const { pool, sql } = fakePool('verified');

    await changeLeadStatus(pool, { ...INPUT, to: 'assigned', agentProfileId: 'agent-1' });

    expect(sql.some((s) => /lead_assignments/.test(s))).toBe(false);
  });

  it('refuses a transition the table does not allow, and writes nothing', async () => {
    const { pool, sql } = fakePool('new');

    const result = await changeLeadStatus(pool, { ...INPUT, to: 'closed' });

    expect(result).toEqual({ ok: false, reason: 'invalid_transition', from: 'new' });
    expect(sql).toEqual(['BEGIN', expect.stringMatching(/^SELECT status/), 'ROLLBACK']);
  });

  it('reports a missing lead', async () => {
    const { pool, sql } = fakePool(null);

    const result = await changeLeadStatus(pool, INPUT);

    expect(result).toEqual({ ok: false, reason: 'not_found' });
    expect(sql[sql.length - 1]).toBe('ROLLBACK');
  });

  it('rolls back and releases when the event insert fails', async () => {
    const sql: string[] = [];
    let released = 0;
    const pool: TransactionalPool = {
      connect: () =>
        Promise.resolve({
          query: ((text: string) => {
            sql.push(text);
            if (text.startsWith('SELECT status')) {
              return Promise.resolve({ rows: [{ status: 'new' }] });
            }
            if (text.startsWith('INSERT')) {
              return Promise.reject(new Error('boom'));
            }
            return Promise.resolve({ rows: [] });
          }) as never,
          release: () => {
            released += 1;
          },
        }),
    };

    await expect(changeLeadStatus(pool, INPUT)).rejects.toThrow('boom');
    expect(sql).toContain('ROLLBACK');
    expect(sql).not.toContain('COMMIT');
    expect(released).toBe(1);
  });
});
