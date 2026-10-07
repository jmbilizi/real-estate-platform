import type { AgentLeadListItem } from '@cribstop/property-contracts';
import { nextTargets, sortLeads } from './agent-leads';

it('offers only the steps the service allows', () => {
  expect(nextTargets('assigned')).toEqual([]);
  expect(nextTargets('accepted')).toEqual(['contacted', 'lost']);
  expect(nextTargets('contacted')).toEqual(['touring', 'under_contract', 'closed', 'lost']);
  expect(nextTargets('touring')).toEqual(['under_contract', 'closed', 'lost']);
  expect(nextTargets('under_contract')).toEqual(['closed', 'lost']);
  expect(nextTargets('closed')).toEqual([]);
  expect(nextTargets('lost')).toEqual([]);
});

it('sorts assigned leads first, newest assignment first', () => {
  const l = (id: string, status: string, assignedAt: string) =>
    ({ id, status, assignedAt }) as AgentLeadListItem;
  const sorted = sortLeads([
    l('a', 'contacted', '2026-10-06T12:00:00Z'),
    l('b', 'assigned', '2026-10-06T08:00:00Z'),
    l('c', 'assigned', '2026-10-06T09:00:00Z'),
  ]);
  expect(sorted.map((x) => x.id)).toEqual(['c', 'b', 'a']);
});
