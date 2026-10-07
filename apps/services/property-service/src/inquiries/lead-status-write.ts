import { LEAD_STATUSES, type LeadStatus } from '@cribstop/property-contracts';
import { canTransition } from './lead-status';
import type { Queryable } from './write';

/** A pool that hands out a client for one transaction. `pg.Pool` fits. */
export interface TransactionalPool {
  connect(): Promise<Queryable & { release(error?: Error): void }>;
}

export interface ChangeLeadStatusInput {
  leadId: string;
  to: LeadStatus;
  /** `null` = the system. */
  actorAccountId: string | null;
  /** The role the actor acted under, or `system`. The caller resolves it. Never client input. */
  actorRole: string;
  note?: string | null;
  /** The agent the event names (an assign). An unassign takes it from the assignment it ends. */
  agentProfileId?: string | null;
  /**
   * Runs inside the transaction, after the lead row is locked and the transition is allowed,
   * before the status changes. A string it returns rolls the change back and comes out as
   * `{ reason: 'rejected', code }`. The assign route uses it for the agent checks.
   */
  precheck?: (client: Queryable, from: LeadStatus) => Promise<string | null>;
  /** Why an open assignment ends when the lead returns to `verified`. Default `returned`. */
  assignmentEndReason?: 'unassigned' | 'returned';
}

export type ChangeLeadStatusResult =
  | { ok: true; from: LeadStatus; to: LeadStatus }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'invalid_transition'; from: LeadStatus }
  | { ok: false; reason: 'rejected'; code: string };

function isLeadStatus(value: unknown): value is LeadStatus {
  return (LEAD_STATUSES as readonly unknown[]).includes(value);
}

/**
 * Moves a lead to a new status and appends the audit event in ONE transaction. The row lock
 * makes two concurrent changes run one after the other, so the second sees the first status.
 */
export async function changeLeadStatus(
  pool: TransactionalPool,
  input: ChangeLeadStatusInput,
): Promise<ChangeLeadStatusResult> {
  const client = await pool.connect();
  let releaseError: Error | undefined;
  try {
    await client.query('BEGIN');

    const current = await client.query<{ status: unknown }>(
      'SELECT status FROM listing_inquiries WHERE id = $1 FOR UPDATE',
      [input.leadId],
    );
    const from = current.rows[0]?.status;
    if (!isLeadStatus(from)) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'not_found' };
    }
    if (!canTransition(from, input.to)) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'invalid_transition', from };
    }

    if (input.precheck !== undefined) {
      const rejection = await input.precheck(client, from);
      if (rejection !== null) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'rejected', code: rejection };
      }
    }

    // A return to `verified` or a final status ends the open assignment, so none outlives its lead.
    let agentProfileId = input.agentProfileId ?? null;
    const endReason =
      input.to === 'verified'
        ? (input.assignmentEndReason ?? 'returned')
        : input.to === 'lost' || input.to === 'closed'
          ? 'closed'
          : null;
    if (endReason !== null) {
      const ended = await client.query<{ agent_profile_id: string }>(
        `UPDATE lead_assignments SET ended_at = now(), end_reason = $2
          WHERE lead_id = $1 AND ended_at IS NULL
          RETURNING agent_profile_id`,
        [input.leadId, endReason],
      );
      agentProfileId = ended.rows[0]?.agent_profile_id ?? agentProfileId;
    }

    await client.query('UPDATE listing_inquiries SET status = $2 WHERE id = $1', [
      input.leadId,
      input.to,
    ]);
    await client.query(
      `INSERT INTO lead_status_events
         (lead_id, from_status, to_status, actor_account_id, actor_role, note, agent_profile_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        input.leadId,
        from,
        input.to,
        input.actorAccountId,
        input.actorRole,
        input.note ?? null,
        agentProfileId,
      ],
    );

    await client.query('COMMIT');
    return { ok: true, from, to: input.to };
  } catch (error) {
    // A failed ROLLBACK means a broken connection. Release it with the error so the pool drops it.
    releaseError = await client.query('ROLLBACK').then(
      () => undefined,
      (rollbackError: unknown) =>
        rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError)),
    );
    throw error;
  } finally {
    client.release(releaseError);
  }
}
