import { LEAD_STATUSES, type LeadStatus } from '@cribstop/property-contracts';
import { canTransition, LEAD_STATUS_TRANSITIONS } from './lead-status';

const ALLOWED: [LeadStatus, LeadStatus][] = Object.entries(LEAD_STATUS_TRANSITIONS).flatMap(
  ([from, targets]) => targets.map((to): [LeadStatus, LeadStatus] => [from as LeadStatus, to]),
);

describe('lead status transitions', () => {
  it('has an entry for every status', () => {
    expect(Object.keys(LEAD_STATUS_TRANSITIONS).sort()).toEqual([...LEAD_STATUSES].sort());
  });

  it.each(ALLOWED)('allows %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  const REFUSED: [LeadStatus, LeadStatus][] = LEAD_STATUSES.flatMap((from) =>
    LEAD_STATUSES.filter((to) => !LEAD_STATUS_TRANSITIONS[from].includes(to)).map(
      (to): [LeadStatus, LeadStatus] => [from, to],
    ),
  );

  it.each(REFUSED)('refuses %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it('never allows a status to follow itself', () => {
    for (const status of LEAD_STATUSES) {
      expect(canTransition(status, status)).toBe(false);
    }
  });

  it.each(['closed', 'lost', 'rejected'] as const)('treats %s as final', (status) => {
    expect(LEAD_STATUS_TRANSITIONS[status]).toEqual([]);
  });
});
