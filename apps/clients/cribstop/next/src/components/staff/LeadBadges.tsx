import type { LeadStatus } from '@cribstop/property-contracts';
import { STATUS_LABEL, STATUS_TONE } from '@/lib/staff-leads';

const PILL = 'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold';

export function StatusBadge({ status }: { status: LeadStatus }) {
  return <span className={`${PILL} ${STATUS_TONE[status]}`}>{STATUS_LABEL[status]}</span>;
}

export function DuplicateBadge() {
  return <span className={`${PILL} bg-amber-100 text-amber-900`}>Possible duplicate</span>;
}

export function VerifiedAccountBadge() {
  return (
    <span className={`${PILL} border border-surface-border bg-white text-ink-body`}>
      Verified account
    </span>
  );
}
