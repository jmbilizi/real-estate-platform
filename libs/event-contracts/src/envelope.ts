import type { EventCategory } from './registry';

/** Flat string map. Max 20 keys, 256 chars per value. No email, phone or buyer message. */
export type EventData = Record<string, string>;

export interface EventEnvelope {
  /** UUID set once by the producer. Equals the outbox row id. */
  id: string;
  /** For example `lead.received`. */
  type: string;
  /** Integer, per type. */
  version: number;
  /** Producing service name. */
  source: string;
  /** ISO 8601 UTC. */
  occurredAt: string;
  aggregateId: string;
  /** An account id only. */
  recipient: { accountId: string };
  category: EventCategory;
  data: EventData;
}
