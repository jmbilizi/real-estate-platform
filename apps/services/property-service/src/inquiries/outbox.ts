import type { LeadStatus } from '@cribstop/property-contracts';
import type { Queryable } from './write';

/**
 * Notification outbox writer (#638). Records what a later sender would send. No sender exists.
 * Every row starts `held` (the column default). No code here or elsewhere updates a row.
 *
 * Only the buyer and the matched agent are ever notified (ruling 2026-10-06). A row holds ids,
 * never an email or a phone number. A buyer row needs recorded email consent.
 */
export type OutboxEvent = 'lead.received' | 'lead.verified' | 'lead.assigned' | 'lead.accepted';

export const OUTBOX_TEMPLATE_KEYS: Readonly<Record<OutboxEvent, string>> = {
  'lead.received': 'buyer-request-received',
  'lead.verified': 'buyer-request-verified',
  'lead.assigned': 'buyer-agent-assigned',
  'lead.accepted': 'buyer-agent-accepted',
};

export const AGENT_ASSIGNED_TEMPLATE_KEY = 'agent-lead-assigned';

/** The outbox event for a status change, or `null` when the change notifies nobody. */
export function outboxEventFor(from: LeadStatus, to: LeadStatus): OutboxEvent | null {
  if (to === 'verified' && from === 'new') return 'lead.verified';
  if (to === 'assigned') return 'lead.assigned';
  if (to === 'accepted') return 'lead.accepted';
  return null;
}

/**
 * Writes the outbox rows of one lead event. Call it inside the transaction that records the event.
 * The buyer row is written only when the lead recorded email consent. The agent row is written
 * only for `lead.assigned` with an agent.
 */
export async function enqueueLeadNotifications(
  client: Queryable,
  input: { leadId: string; event: OutboxEvent; agentProfileId?: string | null },
): Promise<void> {
  const payload = JSON.stringify({ leadId: input.leadId });
  await client.query(
    `INSERT INTO notification_outbox
       (lead_id, event_type, recipient_kind, channel, recipient_ref, recipient_ref_type,
        template_key, payload)
     SELECT id, $2, 'buyer', 'email', COALESCE(account_id, id),
            CASE WHEN account_id IS NULL THEN 'lead' ELSE 'account' END, $3, $4::jsonb
       FROM listing_inquiries
      WHERE id = $1 AND consent_to_contact AND 'email' = ANY(consent_channels)`,
    [input.leadId, input.event, OUTBOX_TEMPLATE_KEYS[input.event], payload],
  );
  if (input.event === 'lead.assigned' && input.agentProfileId) {
    await client.query(
      `INSERT INTO notification_outbox
         (lead_id, event_type, recipient_kind, channel, recipient_ref, recipient_ref_type,
          template_key, payload)
       VALUES ($1, $2, 'agent', 'email', $3, 'agent_profile', $4, $5::jsonb)`,
      [input.leadId, input.event, input.agentProfileId, AGENT_ASSIGNED_TEMPLATE_KEY, payload],
    );
  }
}
