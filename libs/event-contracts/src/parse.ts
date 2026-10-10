import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import type { ValidateFunction } from 'ajv/dist/2020';
import type { EventEnvelope } from './envelope';
import { getSchema, listSchemas } from './registry';

export type ParseResult = { ok: true; event: EventEnvelope } | { ok: false; errors: string[] };

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);

const validators = new Map<string, ValidateFunction>();
for (const { type, version, schema } of listSchemas()) {
  validators.set(`${type}@${version}`, ajv.compile(schema));
}

/** Validates an event against the schema for its own `type` and `version`. Extra fields pass. */
export function parseEvent(input: unknown): ParseResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, errors: ['event must be an object'] };
  }
  const { type, version } = input as { type?: unknown; version?: unknown };
  if (typeof type !== 'string' || typeof version !== 'number' || !getSchema(type, version)) {
    return {
      ok: false,
      errors: [`unknown event type or version: ${String(type)}@${String(version)}`],
    };
  }
  const validate = validators.get(`${type}@${version}`) as ValidateFunction;
  if (validate(input)) return { ok: true, event: input as EventEnvelope };
  return {
    ok: false,
    errors: (validate.errors ?? []).map(
      (e) => `${e.instancePath || '/'} ${e.message ?? 'is invalid'}`,
    ),
  };
}
