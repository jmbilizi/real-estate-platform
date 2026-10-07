import type {
  AgentDeclineReason,
  AgentLeadListItem,
  LeadStatus,
} from '@cribstop/property-contracts';
import { PRICE_WITHHELD_COPY } from '@/lib/listing-format';

/** The reminder near the tour action. The agent owns the buyer agreement. We do not track it. */
export const TOUR_REMINDER = 'A written buyer agreement may be required before touring.';

/** Same hint as the staff notes. A note never records a protected characteristic of the buyer. */
export const AGENT_NOTE_HINT = 'Do not record protected characteristics.';

export const DECLINE_REASON_LABEL: Record<AgentDeclineReason, string> = {
  no_capacity: 'I have no capacity right now',
  outside_service_area: 'Outside my service area',
  conflict_of_interest: 'Conflict of interest',
  listing_unavailable: 'The listing is not available',
  other: 'Other reason',
};

export type AgentTarget = 'contacted' | 'touring' | 'under_contract' | 'closed' | 'lost';

/** The steps after accept, in order. `lost` is a branch, not a step. */
export const STEPS: readonly AgentTarget[] = ['contacted', 'touring', 'under_contract', 'closed'];

/** Mirrors the service table, minus `verified` (that move is decline or staff unassign). */
const NEXT: Partial<Record<LeadStatus, readonly AgentTarget[]>> = {
  accepted: ['contacted', 'lost'],
  contacted: ['touring', 'under_contract', 'closed', 'lost'],
  touring: ['under_contract', 'closed', 'lost'],
  under_contract: ['closed', 'lost'],
};

export function nextTargets(status: LeadStatus): readonly AgentTarget[] {
  return NEXT[status] ?? [];
}

export const TARGET_LABEL: Record<AgentTarget, string> = {
  contacted: 'Contacted',
  touring: 'Touring',
  under_contract: 'Under contract',
  closed: 'Closed',
  lost: 'Lost',
};

/** New assignments first, then the rest. The newest assignment leads in each group. */
export function sortLeads(items: readonly AgentLeadListItem[]): AgentLeadListItem[] {
  const rank = (l: AgentLeadListItem) => (l.status === 'assigned' ? 0 : 1);
  return [...items].sort(
    (a, b) => rank(a) - rank(b) || Date.parse(b.assignedAt) - Date.parse(a.assignedAt),
  );
}

export function formatPrice(listPrice: number | null): string {
  return listPrice === null
    ? PRICE_WITHHELD_COPY
    : new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
      }).format(listPrice);
}
