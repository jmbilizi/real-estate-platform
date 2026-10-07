import type { InquiryKind, LeadStatus } from '@cribstop/property-contracts';

/** The roles that may open the lead desk. The service enforces the same set. */
export const LEAD_DESK_ROLES = ['Admin', 'SuperAdmin', 'Moderator'] as const;

export function hasLeadDeskRole(roles: readonly string[]): boolean {
  return roles.some((r) => (LEAD_DESK_ROLES as readonly string[]).includes(r));
}

export const STATUS_LABEL: Record<LeadStatus, string> = {
  new: 'New',
  verified: 'Verified',
  assigned: 'Assigned',
  accepted: 'Accepted',
  contacted: 'Contacted',
  touring: 'Touring',
  under_contract: 'Under contract',
  closed: 'Closed',
  lost: 'Lost',
  spam: 'Spam',
  rejected: 'Rejected',
};

export const KIND_LABEL: Record<InquiryKind, string> = {
  tour_request: 'Tour request',
  message: 'Message',
};

/** Badge tones. Coral stays reserved for calls to action. */
export const STATUS_TONE: Record<LeadStatus, string> = {
  new: 'bg-ink text-white',
  verified: 'bg-emerald-100 text-emerald-900',
  assigned: 'bg-sky-100 text-sky-900',
  accepted: 'bg-sky-100 text-sky-900',
  contacted: 'bg-sky-100 text-sky-900',
  touring: 'bg-sky-100 text-sky-900',
  under_contract: 'bg-emerald-100 text-emerald-900',
  closed: 'bg-surface-soft text-ink-body',
  lost: 'bg-surface-soft text-ink-body',
  spam: 'bg-amber-100 text-amber-900',
  rejected: 'bg-surface-soft text-ink-body',
};

export type StaffAction = 'verified' | 'spam' | 'rejected';

export const ACTION_LABEL: Record<StaffAction, string> = {
  verified: 'Verify',
  spam: 'Mark as spam',
  rejected: 'Reject',
};

/** The actions a lead status allows. Mirrors the service table. The service decides. */
const ACTIONS_FROM: Partial<Record<LeadStatus, readonly StaffAction[]>> = {
  new: ['verified', 'spam', 'rejected'],
  verified: ['spam', 'rejected'],
};

export function actionsFor(status: LeadStatus): readonly StaffAction[] {
  return ACTIONS_FROM[status] ?? [];
}

export function noteRequired(action: StaffAction): boolean {
  return action === 'spam' || action === 'rejected';
}

/** Whole minutes, hours or days since `iso`. Short, for a list row. */
export function formatAge(iso: string, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** A span in seconds, as the two largest units: `45s`, `12m`, `3h 20m`, `2d 4h`. */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days}d ${hours % 24}h` : `${days}d`;
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

/** A phone number reduced to what a `tel:` link accepts. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

export const NOTE_HINT = 'Do not record protected characteristics.';
