import request from 'supertest';
import { staffLeadMetricsSchema } from '@cribstop/property-contracts';
import { createApp } from '../app';
import type { IntrospectionClient } from '../inquiries/account-introspection';
import type { ReadPool } from '../listings/repository';
import { ROLE } from './roles';

interface Call {
  sql: string;
  params: unknown[];
}

const client: IntrospectionClient = {
  resolveAccountId: () => Promise.resolve(null),
  introspect: () =>
    Promise.resolve({
      kind: 'account',
      accountId: '0190a000-0000-7000-8000-00000000000a',
      roles: [ROLE.Moderator],
    }),
};

/** A pool that answers the three metric queries by their first table or CTE. */
function fakePool(answers: { counts?: unknown[]; aging?: unknown[]; durations?: unknown[] } = {}) {
  const calls: Call[] = [];
  return {
    calls,
    query: (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes('WITH cohort')) return Promise.resolve({ rows: answers.durations ?? [] });
      if (sql.includes("status IN ('new', 'verified')"))
        return Promise.resolve({ rows: answers.aging ?? [{ n: 0 }] });
      return Promise.resolve({ rows: answers.counts ?? [] });
    },
  };
}

const appWith = (pool: ReturnType<typeof fakePool>) =>
  createApp({ pool: pool as unknown as ReadPool, introspection: client });

describe('GET /staff/leads/metrics', () => {
  it('returns an explicit empty state, never an invented number', async () => {
    const res = await request(appWith(fakePool())).get('/staff/leads/metrics');
    expect(res.status).toBe(200);
    const body = staffLeadMetricsSchema.parse(res.body);
    expect(body.total).toBe(0);
    expect(Object.values(body.byStatus).every((n) => n === 0)).toBe(true);
    expect(body.timeToVerify).toEqual({ sampleSize: 0, medianSeconds: null, p90Seconds: null });
    expect(body.aging.count).toBe(0);
  });

  it('sums counts, rounds durations and passes the range to every query', async () => {
    const pool = fakePool({
      counts: [
        { status: 'new', kind: 'message', n: 2 },
        { status: 'new', kind: 'tour_request', n: 1 },
        { status: 'verified', kind: 'message', n: 4 },
      ],
      aging: [{ n: 3 }],
      durations: [{ step: 'verify', n: 5, median: '1200.4', p90: 2160 }],
    });
    const res = await request(appWith(pool)).get(
      '/staff/leads/metrics?from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z',
    );
    const body = staffLeadMetricsSchema.parse(res.body);
    expect(body.total).toBe(7);
    expect(body.byStatus).toMatchObject({ new: 3, verified: 4, assigned: 0 });
    expect(body.byKind).toEqual({ message: 6, tour_request: 1 });
    expect(body.timeToVerify).toEqual({ sampleSize: 5, medianSeconds: 1200, p90Seconds: 2160 });
    expect(body.timeToAssign.medianSeconds).toBeNull();
    expect(body.aging).toEqual({ thresholdHours: 24, count: 3 });
    for (const call of pool.calls) {
      expect(call.params.slice(0, 2)).toEqual(['2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z']);
    }
  });

  it.each([
    ['from=yesterday'],
    ['status=new'],
    ['from=2026-10-07T00:00:00Z&to=2026-10-06T00:00:00Z'],
  ])('answers 400 for %s, before any query', async (qs) => {
    const pool = fakePool();
    const res = await request(appWith(pool)).get(`/staff/leads/metrics?${qs}`);
    expect(res.status).toBe(400);
    expect(pool.calls).toHaveLength(0);
  });

  it('reads only. No statement writes', async () => {
    const pool = fakePool();
    await request(appWith(pool)).get('/staff/leads/metrics');
    for (const call of pool.calls) expect(call.sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
  });
});
