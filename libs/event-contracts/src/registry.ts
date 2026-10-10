import leadReceivedV1 from './schemas/lead.received.v1.json';
import leadAcceptedV1 from './schemas/lead.accepted.v1.json';
import leadAssignedV1 from './schemas/lead.assigned.v1.json';
import securityEmailChangedV1 from './schemas/security.email_changed.v1.json';
import securityPasswordChangedV1 from './schemas/security.password_changed.v1.json';

export const EVENT_CATEGORIES = ['transactional', 'non_transactional'] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

/** Every released schema, keyed by event type, then by version. Add a row here for each new schema file. */
export const SCHEMAS = {
  'lead.received': { 1: leadReceivedV1 },
  'lead.accepted': { 1: leadAcceptedV1 },
  'lead.assigned': { 1: leadAssignedV1 },
  'security.email_changed': { 1: securityEmailChangedV1 },
  'security.password_changed': { 1: securityPasswordChangedV1 },
} as const;

export type EventType = keyof typeof SCHEMAS;

export const EVENT_TYPES = Object.keys(SCHEMAS) as EventType[];

export type JsonSchema = Record<string, unknown>;

export function getSchema(type: string, version: number): JsonSchema | undefined {
  const versions = (SCHEMAS as Record<string, Record<number, JsonSchema> | undefined>)[type];
  return versions?.[version];
}

export function listSchemas(): { type: string; version: number; schema: JsonSchema }[] {
  return Object.entries(SCHEMAS).flatMap(([type, versions]) =>
    Object.entries(versions).map(([version, schema]) => ({
      type,
      version: Number(version),
      schema: schema as JsonSchema,
    })),
  );
}
