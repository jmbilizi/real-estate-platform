import { type DeliveryChannel, DeliveryError, type DeliveryMessage } from './channel';
import { type DeliveryTuning, resolveSendConfig } from './config';
import type { Queryable } from '../write';
import { backoffMs, type DeliveryLogger, runDeliveryTick } from './worker';

/** A small in-memory stand-in for `listing_inquiries`. It matches each store statement by its SQL. */
interface Row {
  id: string;
  state: 'pending' | 'sending' | 'delivered' | 'failed' | 'sample';
  attempts: number;
  sample: boolean;
  messageId?: string;
  error?: string;
  backoffMs?: number;
}

function fakeDb(rows: Row[], overdue = { count: 0, oldest: 0 }): Queryable {
  return {
    query: ((sql: string, params: unknown[] = []) => {
      if (sql.includes("SET delivery_state = 'sample'")) {
        const hit = rows.filter((r) => r.sample && ['pending', 'sending'].includes(r.state));
        hit.forEach((r) => (r.state = 'sample'));
        return Promise.resolve({ rows: hit.map((r) => ({ id: r.id })) });
      }
      if (sql.includes('Worker stopped mid-send')) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes('WITH due AS')) {
        const hit = rows.filter((r) => r.state === 'pending').slice(0, Number(params[0]));
        hit.forEach((r) => {
          r.state = 'sending';
          r.attempts += 1;
        });
        return Promise.resolve({
          rows: hit.map((r) => ({
            id: r.id,
            listing_id: 'lst-1',
            kind: 'message',
            name: 'Jane',
            email: 'jane@example.com',
            phone: null,
            message: 'Hello',
            created_at: new Date('2026-10-04T12:00:00Z'),
            delivery_attempts: r.attempts,
            address: null,
            address_display_allowed: false,
          })),
        });
      }
      const target = rows.find((r) => r.id === params[0]);
      if (sql.includes("delivery_state = 'delivered'") && target) {
        target.state = 'delivered';
        target.messageId = params[1] as string;
      } else if (sql.includes("SET delivery_state = 'pending'") && target) {
        target.state = 'pending';
        target.error = params[1] as string;
        target.backoffMs = params[2] as number;
      } else if (sql.includes("SET delivery_state = 'failed'") && target) {
        target.state = 'failed';
        target.error = params[1] as string;
      } else if (sql.includes('count(*)')) {
        return Promise.resolve({
          rows: [{ count: String(overdue.count), oldest_age_seconds: String(overdue.oldest) }],
        });
      }
      return Promise.resolve({ rows: [] });
    }) as Queryable['query'],
  };
}

const TUNING: DeliveryTuning = {
  intervalMs: 1000,
  batchSize: 10,
  maxAttempts: 3,
  baseBackoffMs: 1000,
  maxBackoffMs: 5000,
  leaseMs: 60_000,
  overdueAgeMs: 900_000,
  siteOrigin: null,
};

const ENABLED = resolveSendConfig({
  INQUIRY_EXTERNAL_SEND: 'true',
  POSTMARK_SERVER_TOKEN: 'sandbox',
  INQUIRY_INTAKE_ADDRESS: 'intake@cribstop.example',
  INQUIRY_FROM_ADDRESS: 'no-reply@cribstop.example',
});
const DISABLED = resolveSendConfig({});

function row(id: string, patch: Partial<Row> = {}): Row {
  return { id, state: 'pending', attempts: 0, sample: false, ...patch };
}

function setup(
  rows: Row[],
  channel: DeliveryChannel | null,
  resolution = ENABLED,
  overdue?: { count: number; oldest: number },
) {
  const entries: { level: string; entry: Record<string, unknown> }[] = [];
  const log: DeliveryLogger = (level, entry) => entries.push({ level, entry });
  const run = () =>
    runDeliveryTick({ db: fakeDb(rows, overdue), channel, resolution, tuning: TUNING, log });
  return { run, entries };
}

describe('runDeliveryTick', () => {
  it('delivers a pending inquiry and records the MessageID', async () => {
    const sent: DeliveryMessage[] = [];
    const channel: DeliveryChannel = {
      send: (message) => {
        sent.push(message);
        return Promise.resolve({ messageId: 'pm-1' });
      },
    };
    const rows = [row('a')];
    const { run } = setup(rows, channel);

    const result = await run();

    expect(result.delivered).toBe(1);
    expect(rows[0]).toMatchObject({ state: 'delivered', messageId: 'pm-1' });
    expect(sent[0]?.to).toBe('intake@cribstop.example');
  });

  it('retries a transient failure with backoff and keeps the inquiry', async () => {
    const channel: DeliveryChannel = {
      send: () => Promise.reject(new DeliveryError('Postmark down', true)),
    };
    const rows = [row('a')];
    const { run, entries } = setup(rows, channel);

    const result = await run();

    expect(result.retried).toBe(1);
    expect(rows[0]).toMatchObject({ state: 'pending', backoffMs: 1000, error: 'Postmark down' });
    expect(entries.some((e) => e.entry.event === 'inquiry_delivery_retry')).toBe(true);
  });

  it('marks failed once attempts reach the maximum', async () => {
    const channel: DeliveryChannel = {
      send: () => Promise.reject(new DeliveryError('Postmark down', true)),
    };
    const rows = [row('a', { attempts: 2 })];
    const { run, entries } = setup(rows, channel);

    const result = await run();

    expect(result.failed).toBe(1);
    expect(rows[0]?.state).toBe('failed');
    expect(
      entries.some((e) => e.level === 'error' && e.entry.event === 'inquiry_delivery_failed'),
    ).toBe(true);
  });

  it('fails a non-retryable error at once', async () => {
    const channel: DeliveryChannel = {
      send: () => Promise.reject(new DeliveryError('Bad request', false)),
    };
    const rows = [row('a')];
    const { run } = setup(rows, channel);

    await run();

    expect(rows[0]?.state).toBe('failed');
  });

  it('sends nothing when sending is disabled, and leaves the inquiry pending', async () => {
    const send = jest.fn();
    const rows = [row('a')];
    const { run } = setup(rows, null, DISABLED);

    const result = await run();

    expect(send).not.toHaveBeenCalled();
    expect(result.delivered).toBe(0);
    expect(rows[0]?.state).toBe('pending');
  });

  it('marks a sample-listing inquiry and never sends it', async () => {
    const send = jest.fn(() => Promise.resolve({ messageId: 'x' }));
    const rows = [row('a', { sample: true })];
    const { run } = setup(rows, { send });

    const result = await run();

    expect(result.sampled).toBe(1);
    expect(rows[0]?.state).toBe('sample');
    expect(send).not.toHaveBeenCalled();
  });

  it('marks sample inquiries even while sending is disabled', async () => {
    const rows = [row('a', { sample: true })];
    const { run } = setup(rows, null, DISABLED);

    await run();

    expect(rows[0]?.state).toBe('sample');
  });

  it('logs an overdue inquiry as an error event, naming why when sending is disabled', async () => {
    const { run, entries } = setup([], null, DISABLED, { count: 2, oldest: 4000 });

    const result = await run();

    expect(result.overdue).toBe(2);
    const alert = entries.find((e) => e.entry.event === 'inquiry_delivery_overdue');
    expect(alert?.level).toBe('error');
    expect(alert?.entry).toMatchObject({
      count: 2,
      oldestAgeSeconds: 4000,
      sendingEnabled: false,
    });
    expect(String(alert?.entry.disabledReason)).toMatch(/INQUIRY_EXTERNAL_SEND/);
  });

  it('logs nothing alertable when nothing is overdue', async () => {
    const { run, entries } = setup([row('a')], { send: () => Promise.resolve({ messageId: 'm' }) });

    await run();

    expect(entries.some((e) => e.entry.event === 'inquiry_delivery_overdue')).toBe(false);
  });

  it('does not retry or resend when recording a successful send fails', async () => {
    const send = jest.fn(() => Promise.resolve({ messageId: 'pm-9' }));
    const rows = [row('a')];
    const inner = fakeDb(rows);
    const db: Queryable = {
      query: ((sql: string, params?: unknown[]) =>
        sql.includes("delivery_state = 'delivered'")
          ? Promise.reject(new Error('statement timeout'))
          : inner.query(sql, params)) as Queryable['query'],
    };
    const entries: { entry: Record<string, unknown> }[] = [];
    const result = await runDeliveryTick({
      db,
      channel: { send },
      resolution: ENABLED,
      tuning: TUNING,
      log: (_level, entry) => entries.push({ entry }),
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ delivered: 0, retried: 0, failed: 0 });
    expect(rows[0]?.state).toBe('sending');
    expect(entries.some((e) => e.entry.event === 'inquiry_delivery_record_failed')).toBe(true);
  });

  it('never logs consumer data', async () => {
    const channel: DeliveryChannel = {
      send: () => Promise.reject(new DeliveryError('Postmark down', true)),
    };
    const { run, entries } = setup([row('a')], channel);

    await run();

    const text = JSON.stringify(entries);
    expect(text).not.toContain('jane@example.com');
    expect(text).not.toContain('Hello');
  });
});

describe('backoffMs', () => {
  it('doubles per attempt and caps at the maximum', () => {
    expect(backoffMs(TUNING, 1)).toBe(1000);
    expect(backoffMs(TUNING, 2)).toBe(2000);
    expect(backoffMs(TUNING, 3)).toBe(4000);
    expect(backoffMs(TUNING, 4)).toBe(5000);
  });
});
