import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  breakingChanges,
  dlqFor,
  EVENT_TYPES,
  EventEnvelope,
  fromStreamFields,
  listSchemas,
  parseEvent,
  streamFor,
  toStreamFields,
} from './index';

const valid = (over: Partial<EventEnvelope> = {}): EventEnvelope => ({
  id: '3f1c2a64-8d0e-4b8e-9a53-0f6f2f6f1c11',
  type: 'lead.received',
  version: 1,
  source: 'property-service',
  occurredAt: '2026-10-09T12:00:00Z',
  aggregateId: 'lead-123',
  recipient: { accountId: 'acct-1' },
  category: 'non_transactional',
  data: { listingId: 'L-1' },
  ...over,
});

describe('parseEvent', () => {
  it.each(EVENT_TYPES)('accepts a valid %s event', (type) => {
    const data: Record<string, string> = type.startsWith('lead.')
      ? { listingId: 'L-1', agentAccountId: 'acct-2' }
      : {};
    const category = type.startsWith('security.') ? 'transactional' : 'non_transactional';
    const result = parseEvent(valid({ type, data, category }));
    expect(result).toMatchObject({ ok: true });
  });

  it('allows unknown extra fields', () => {
    expect(parseEvent({ ...valid(), traceId: 'abc' })).toMatchObject({ ok: true });
  });

  it.each([
    ['non-object', 'nope'],
    ['unknown type', valid({ type: 'lead.unknown' })],
    ['unknown version', valid({ version: 9 })],
    ['bad uuid', valid({ id: 'not-a-uuid' })],
    ['non-UTC time', valid({ occurredAt: '2026-10-09T12:00:00+02:00' })],
    ['bad category', valid({ category: 'other' as never })],
    ['missing required data key', valid({ data: {} })],
    ['recipient with extra field', valid({ recipient: { accountId: 'a', email: 'x' } as never })],
    [
      'security event with wrong category',
      valid({ type: 'security.email_changed', data: {}, category: 'non_transactional' }),
    ],
  ])('rejects %s', (_name, input) => {
    expect(parseEvent(input).ok).toBe(false);
  });

  it('rejects more than 20 data keys', () => {
    const data: Record<string, string> = { listingId: 'L-1' };
    for (let i = 0; i < 20; i++) data[`k${i}`] = 'v';
    expect(parseEvent(valid({ data })).ok).toBe(false);
    delete data['k0'];
    expect(parseEvent(valid({ data })).ok).toBe(true);
  });

  it('rejects a data value over 256 chars', () => {
    expect(parseEvent(valid({ data: { listingId: 'x'.repeat(257) } })).ok).toBe(false);
    expect(parseEvent(valid({ data: { listingId: 'x'.repeat(256) } })).ok).toBe(true);
  });

  it('rejects non-string data values', () => {
    expect(parseEvent(valid({ data: { listingId: 1 as never } })).ok).toBe(false);
  });

  it.each([
    ['email address', { listingId: 'L-1', note: 'jane@example.com' }],
    ['phone number', { listingId: 'L-1', note: '(202) 555-0147' }],
    ['phone digits', { listingId: 'L-1', note: '2025550147' }],
    ['international phone', { listingId: 'L-1', note: '+44 20 7946 0958' }],
    ['phoneNumber key', { listingId: 'L-1', phoneNumber: 'x' }],
    ['emailAddress key', { listingId: 'L-1', emailAddress: 'x' }],
    ['key with trailing newline', { listingId: 'L-1', 'note\n': 'x' }],
    ['email key', { listingId: 'L-1', email: 'x' }],
    ['phone key', { listingId: 'L-1', phone: 'x' }],
    ['message key', { listingId: 'L-1', message: 'hello' }],
  ])('rejects contact detail in data: %s', (_name, data) => {
    expect(parseEvent(valid({ data })).ok).toBe(false);
  });
});

describe('stream naming', () => {
  it('maps a type to its stream and DLQ', () => {
    expect(streamFor('lead.received')).toBe('events.lead');
    expect(streamFor('security.email_changed')).toBe('events.security');
    expect(dlqFor('lead.received')).toBe('events-dlq.lead');
  });

  it('throws on a malformed type', () => {
    expect(() => streamFor('lead')).toThrow();
    expect(() => dlqFor('Lead.Received')).toThrow();
  });
});

describe('stream entry encoding', () => {
  it('round-trips an event through the entry fields', () => {
    const event = valid();
    const fields = toStreamFields(event);
    expect(Object.keys(fields).sort()).toEqual(['envelope', 'id', 'type']);
    expect(fields.type).toBe('lead.received');
    expect(fields.id).toBe(event.id);
    expect(fromStreamFields(fields)).toEqual({ ok: true, event });
  });

  it('rejects an entry whose type or id differs from the envelope', () => {
    const fields = toStreamFields(valid());
    expect(fromStreamFields({ ...fields, type: 'lead.accepted' }).ok).toBe(false);
    expect(fromStreamFields({ ...fields, id: 'other' }).ok).toBe(false);
  });

  it('accepts ISO dates and short ids in data', () => {
    expect(parseEvent(valid({ data: { listingId: 'L-1', day: '2026-10-09' } })).ok).toBe(true);
  });

  it('reports a missing or broken envelope field', () => {
    expect(fromStreamFields({})).toMatchObject({ ok: false });
    expect(fromStreamFields({ envelope: '{' })).toMatchObject({ ok: false });
  });
});

describe('schema compatibility', () => {
  const schemaDir = join(__dirname, 'schemas');
  const baselineDir = join(__dirname, '..', 'compat', 'baseline');
  const read = (dir: string, file: string): any =>
    JSON.parse(readFileSync(join(dir, file), 'utf8'));

  it('registers every schema file, and only those', () => {
    const files = readdirSync(schemaDir).sort();
    const registered = listSchemas()
      .map((s) => `${s.type}.v${s.version}.json`)
      .sort();
    expect(registered).toEqual(files);
  });

  it('has a released baseline for every schema file', () => {
    expect(readdirSync(baselineDir).sort()).toEqual(readdirSync(schemaDir).sort());
  });

  it.each(readdirSync(join(__dirname, '..', 'compat', 'baseline')))(
    'keeps %s backward compatible with its released baseline',
    (file) => {
      expect(breakingChanges(read(baselineDir, file), read(schemaDir, file))).toEqual([]);
    },
  );

  describe('breakingChanges', () => {
    const base = read(join(__dirname, '..', 'compat', 'baseline'), 'lead.received.v1.json');
    const clone = (): any => JSON.parse(JSON.stringify(base));

    it('accepts an added unconstrained field', () => {
      const next = clone();
      next.properties.priority = { description: 'free form' };
      expect(breakingChanges(base, next)).toEqual([]);
    });

    it('flags an added field that constrains a key old events may carry', () => {
      const next = clone();
      next.properties.priority = { type: 'string' };
      expect(breakingChanges(base, next).join()).toMatch(/priority/);
    });

    it('accepts a wider limit and a removed limit', () => {
      const next = clone();
      next.properties.data.maxProperties = 30;
      delete next.properties.source.maxLength;
      expect(breakingChanges(base, next)).toEqual([]);
    });

    it('flags a stricter additionalProperties schema', () => {
      const next = clone();
      next.properties.data.additionalProperties.maxLength = 100;
      expect(breakingChanges(base, next).join()).toMatch(
        /additionalProperties.*maxLength narrowed/,
      );
    });

    it('flags a type added to a typeless old schema', () => {
      const old = { type: 'object', properties: { a: {} } };
      const next = { type: 'object', properties: { a: { type: 'string' } } };
      expect(breakingChanges(old, next).join()).toMatch(/properties\/a: type changed/);
    });

    it('fails closed on an unsupported keyword change', () => {
      const next = clone();
      next.properties.source.minimum = 1;
      expect(breakingChanges(base, next).join()).toMatch(/unsupported keyword minimum/);
    });

    it('flags a removed field', () => {
      const next = clone();
      delete next.properties.aggregateId;
      expect(breakingChanges(base, next)).toContain('#/properties/aggregateId: field removed');
    });

    it('flags a changed type', () => {
      const next = clone();
      next.properties.source.type = 'integer';
      expect(breakingChanges(base, next).join()).toMatch(/source: type changed/);
    });

    it('flags a narrowed limit', () => {
      const next = clone();
      next.properties.source.maxLength = 10;
      expect(breakingChanges(base, next).join()).toMatch(/source: maxLength narrowed/);
    });

    it('flags a removed enum value', () => {
      const next = clone();
      next.properties.category.enum = ['transactional'];
      expect(breakingChanges(base, next).join()).toMatch(/category: enum value removed/);
    });

    it('flags a newly required field', () => {
      const next = clone();
      next.required.push('traceId');
      expect(breakingChanges(base, next).join()).toMatch(/traceId became required/);
    });

    it('flags a newly closed object', () => {
      const next = clone();
      next.additionalProperties = false;
      expect(breakingChanges(base, next).join()).toMatch(/additionalProperties narrowed/);
    });
  });
});
