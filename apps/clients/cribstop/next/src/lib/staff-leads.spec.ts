import {
  actionsFor,
  formatAge,
  hasLeadDeskRole,
  LEAD_DESK_ROLES,
  noteRequired,
  telHref,
} from './staff-leads';
import { LEAD_STATUSES, MODERATOR_TARGET_STATUSES } from '@cribstop/property-contracts';

describe('hasLeadDeskRole', () => {
  it.each(LEAD_DESK_ROLES)('allows %s', (role) => {
    expect(hasLeadDeskRole(['User', role])).toBe(true);
  });
  it.each([[[]], [['User']], [['Agent', 'Provider']]])('refuses %j', (roles) => {
    expect(hasLeadDeskRole(roles)).toBe(false);
  });
});

describe('actionsFor', () => {
  it('offers all three on a new lead', () => {
    expect(actionsFor('new')).toEqual(['verified', 'spam', 'rejected']);
  });
  it('does not offer verify twice', () => {
    expect(actionsFor('verified')).toEqual(['spam', 'rejected']);
  });
  it('offers nothing on other statuses', () => {
    for (const s of LEAD_STATUSES.filter((x) => x !== 'new' && x !== 'verified')) {
      expect(actionsFor(s)).toEqual([]);
    }
  });
  it('only offers targets a moderator may set', () => {
    for (const s of LEAD_STATUSES) {
      for (const a of actionsFor(s)) expect(MODERATOR_TARGET_STATUSES).toContain(a);
    }
  });
});

it('requires a note for spam and rejected only', () => {
  expect(noteRequired('spam')).toBe(true);
  expect(noteRequired('rejected')).toBe(true);
  expect(noteRequired('verified')).toBe(false);
});

it('formats ages', () => {
  const now = Date.parse('2026-10-07T12:00:00Z');
  expect(formatAge('2026-10-07T11:30:00Z', now)).toBe('30m');
  expect(formatAge('2026-10-07T07:00:00Z', now)).toBe('5h');
  expect(formatAge('2026-10-04T12:00:00Z', now)).toBe('3d');
});

it('strips a phone number for tel links', () => {
  expect(telHref('(202) 555-0100')).toBe('tel:2025550100');
});
