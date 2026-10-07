import type { LeadStatus } from '@cribstop/property-contracts';

/**
 * THE ONLY PLACE that says which lead status may follow which (#627). The staff and agent
 * routes call `canTransition` or `changeLeadStatus`. They never keep their own table.
 *
 * `closed`, `lost` and `rejected` are final. `spam` can return to `new`, so a moderator can undo
 * a wrong call.
 */
export const LEAD_STATUS_TRANSITIONS: Readonly<Record<LeadStatus, readonly LeadStatus[]>> = {
  new: ['verified', 'spam', 'rejected'],
  verified: ['assigned', 'spam', 'rejected', 'lost'],
  // `verified` = the agent declined or staff unassigned the lead.
  assigned: ['accepted', 'verified', 'lost'],
  accepted: ['contacted', 'verified', 'lost'],
  contacted: ['touring', 'under_contract', 'lost', 'closed'],
  touring: ['under_contract', 'lost', 'closed'],
  under_contract: ['closed', 'lost'],
  closed: [],
  lost: [],
  spam: ['new'],
  rejected: [],
};

export function canTransition(from: LeadStatus, to: LeadStatus): boolean {
  return LEAD_STATUS_TRANSITIONS[from].includes(to);
}
