import type { EventEnvelope } from './envelope';
import { parseEvent, type ParseResult } from './parse';

const TYPE_PATTERN = /^([a-z][a-z0-9_]*)\.[a-z][a-z0-9_]*$/;

function aggregateOf(type: string): string {
  const match = TYPE_PATTERN.exec(type);
  if (!match) throw new Error(`invalid event type: ${type}`);
  return match[1] as string;
}

/** `lead.received` gives `events.lead`. */
export function streamFor(type: string): string {
  return `events.${aggregateOf(type)}`;
}

/** `lead.received` gives `events-dlq.lead`. */
export function dlqFor(type: string): string {
  return `events-dlq.${aggregateOf(type)}`;
}

/** Field map for one Redis Streams entry: the full JSON, plus `type` and `id` for filtering. */
export function toStreamFields(event: EventEnvelope): {
  envelope: string;
  type: string;
  id: string;
} {
  return { envelope: JSON.stringify(event), type: event.type, id: event.id };
}

/** Reads the `envelope` field of a stream entry and validates it. */
export function fromStreamFields(fields: Record<string, string>): ParseResult {
  const raw = fields['envelope'];
  if (raw === undefined) return { ok: false, errors: ['entry has no envelope field'] };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, errors: ['envelope field is not valid JSON'] };
  }
  const result = parseEvent(json);
  if (!result.ok) return result;
  const { type, id } = fields;
  if (
    (type !== undefined && type !== result.event.type) ||
    (id !== undefined && id !== result.event.id)
  ) {
    return { ok: false, errors: ['entry type or id does not match the envelope'] };
  }
  return result;
}
