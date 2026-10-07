import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import axios from 'axios';
import { FORBIDDEN_BODY, staffLeadMetricsSchema } from '@cribstop/property-contracts';
import { closePool, getPool } from '../src/db/pool';
import { complianceFixtureIds } from './support/fixture-ids';
import {
  bearerFor,
  introspectionStubUrl,
  startIntrospectionStub,
  stopIntrospectionStub,
} from './support/introspection-stub';

/**
 * The lead desk metrics (#639) against a REAL service and REAL database. Start the service with
 * `ACCOUNT_SERVICE_INTROSPECT_URL` set to the stub this file starts. The leads sit in 2020, a
 * year no other suite writes to, and in the past, so the aging count is stable.
 */
const listing = complianceFixtureIds().sampleListingId;
const cfg = (...roles: string[]) => ({
  headers: bearerFor(randomUUID(), roles),
  validateStatus: () => true,
});
const asAdmin = cfg('User', 'Admin');
const asSuperAdmin = cfg('SuperAdmin');
const asModerator = cfg('User', 'Agent', 'Moderator');
const asBuyer = cfg('User');
const asAgent = cfg('User', 'Agent');
const anonymous = { validateStatus: () => true };

const MIN = 60_000;
const T0 = Date.parse('2020-03-01T12:00:00.000Z');
const window = (year: number) => ({
  from: `${year}-01-01T00:00:00Z`,
  to: `${year + 1}-01-01T00:00:00Z`,
});

let stub: Server;

/** A lead with a journey. Each step is the minutes after the previous event. */
async function seedJourney(
  kind: 'message' | 'tour_request',
  steps: { to: string; afterMin: number }[],
): Promise<void> {
  const pool = getPool();
  const status = steps.at(-1)?.to ?? 'new';
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO listing_inquiries
       (listing_id, kind, name, email, message, status, created_at)
     VALUES ($1, $2, 'E2E Lead', $3, 'Hello (e2e)', $4, $5::timestamptz)
     RETURNING id`,
    [listing, kind, `${randomUUID()}@e2e.example.com`, status, new Date(T0).toISOString()],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('seed failed');
  let from: string | null = null;
  let time = T0;
  for (const step of [{ to: 'new', afterMin: 0 }, ...steps]) {
    time += step.afterMin * MIN;
    await pool.query(
      `INSERT INTO lead_status_events (lead_id, from_status, to_status, actor_role, created_at)
       VALUES ($1, $2, $3, 'system', $4)`,
      [id, from, step.to, new Date(time).toISOString()],
    );
    from = step.to;
  }
}

const metrics = (query: Record<string, string>, config = asAdmin) =>
  axios.get('/staff/leads/metrics', { ...config, params: query });

beforeAll(async () => {
  stub = await startIntrospectionStub();
  const probe = await axios.get('/staff/leads/metrics', asAdmin);
  if (probe.status === 401 || probe.status === 403) {
    throw new Error(
      `The service rejected the staff e2e credential. Start it with ACCOUNT_SERVICE_INTROSPECT_URL=${introspectionStubUrl()}`,
    );
  }
  await seedJourney('message', [
    { to: 'verified', afterMin: 10 },
    { to: 'assigned', afterMin: 30 },
    { to: 'accepted', afterMin: 60 },
  ]);
  await seedJourney('tour_request', [
    { to: 'verified', afterMin: 20 },
    { to: 'assigned', afterMin: 90 },
  ]);
  await seedJourney('message', [{ to: 'verified', afterMin: 40 }]);
  await seedJourney('message', []);
});

afterAll(async () => {
  await stopIntrospectionStub(stub);
  await closePool();
});

describe('GET /staff/leads/metrics', () => {
  it('answers 401 signed out and 403 for a buyer and an Agent', async () => {
    expect((await axios.get('/staff/leads/metrics', anonymous)).status).toBe(401);
    for (const config of [asBuyer, asAgent]) {
      const res = await axios.get('/staff/leads/metrics', config);
      expect(res.status).toBe(403);
      expect(res.data).toEqual(FORBIDDEN_BODY);
    }
  });

  it('allows Admin, SuperAdmin and a multi-role Moderator', async () => {
    for (const config of [asAdmin, asSuperAdmin, asModerator]) {
      const res = await metrics(window(2020), config);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toContain('no-store');
    }
  });

  it('computes counts, median, p90 and aging from seeded events', async () => {
    const body = staffLeadMetricsSchema.parse((await metrics(window(2020))).data);
    expect(body.total).toBe(4);
    expect(body.byStatus).toMatchObject({ new: 1, verified: 1, assigned: 1, accepted: 1, spam: 0 });
    expect(body.byKind).toEqual({ message: 3, tour_request: 1 });
    expect(body.timeToVerify).toEqual({ sampleSize: 3, medianSeconds: 1200, p90Seconds: 2160 });
    expect(body.timeToAssign).toEqual({ sampleSize: 2, medianSeconds: 3600, p90Seconds: 5040 });
    expect(body.timeToAccept).toEqual({ sampleSize: 1, medianSeconds: 3600, p90Seconds: 3600 });
    expect(body.aging).toEqual({ thresholdHours: 24, count: 2 });
  });

  it('applies the range to every value and returns nulls for an empty range', async () => {
    const body = staffLeadMetricsSchema.parse((await metrics(window(2021))).data);
    expect(body.total).toBe(0);
    expect(Object.values(body.byStatus).every((n) => n === 0)).toBe(true);
    expect(body.aging.count).toBe(0);
    for (const d of [body.timeToVerify, body.timeToAssign, body.timeToAccept]) {
      expect(d).toEqual({ sampleSize: 0, medianSeconds: null, p90Seconds: null });
    }
  });

  it('exposes no personal data and rejects a bad range or parameter', async () => {
    const res = await metrics(window(2020));
    expect(JSON.stringify(res.data)).not.toMatch(/@|E2E Lead|Hello/);
    const reversed = await metrics({ from: '2021-01-01T00:00:00Z', to: '2020-01-01T00:00:00Z' });
    expect(reversed.status).toBe(400);
    expect((await metrics({ from: 'yesterday' })).status).toBe(400);
    expect((await metrics({ status: 'new' })).status).toBe(400);
  });
});
