'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  INQUIRY_KINDS,
  LEAD_STATUSES,
  type InquiryKind,
  type LeadStatus,
  type StaffLeadListItem,
} from '@cribstop/property-contracts';
import Button from '@/components/Button';
import { fetchLeads, StaffApiError, type LeadFilters } from '@/lib/api/staff-leads';
import { formatAge, KIND_LABEL, STATUS_LABEL } from '@/lib/staff-leads';
import { DuplicateBadge, StatusBadge, VerifiedAccountBadge } from './LeadBadges';
import { LEAD_ROW_GRID, LeadsListSkeleton } from './LeadSkeletons';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELD =
  'min-h-11 w-full rounded-md border border-surface-border bg-white px-3 text-sm text-ink focus:border-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-ink';

interface Draft {
  status: string;
  kind: string;
  from: string;
  to: string;
  listingId: string;
}
const EMPTY: Draft = { status: '', kind: '', from: '', to: '', listingId: '' };

/** A date input value is a local calendar day. `createdTo` is exclusive, so it is the next day. */
function dayStart(day: string, plusDays = 0): string {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + plusDays);
  return d.toISOString();
}

function toFilters(d: Draft): LeadFilters {
  return {
    status: (d.status || undefined) as LeadStatus | undefined,
    kind: (d.kind || undefined) as InquiryKind | undefined,
    createdFrom: d.from ? dayStart(d.from) : undefined,
    createdTo: d.to ? dayStart(d.to, 1) : undefined,
    listingId: d.listingId.trim() || undefined,
  };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs font-semibold text-ink-body">
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  );
}

function LeadRow({ lead }: { lead: StaffLeadListItem }) {
  return (
    <li>
      <Link
        href={`/admin/leads/${lead.id}`}
        className={`block min-h-11 rounded-lg border border-surface-border bg-white p-4 hover:border-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink layout:rounded-none layout:border-0 layout:px-4 layout:hover:bg-surface-alt ${LEAD_ROW_GRID} layout:items-center`}
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{lead.name}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <StatusBadge status={lead.status} />
            {lead.possibleDuplicate && <DuplicateBadge />}
            {lead.verifiedAccount && <VerifiedAccountBadge />}
          </div>
        </div>
        <div className="mt-3 min-w-0 text-sm text-ink-body layout:mt-0">
          <p className="truncate">{lead.emailMasked}</p>
          <p className="truncate text-ink-muted">{lead.phoneMasked ?? 'No phone'}</p>
        </div>
        <p className="mt-3 text-sm text-ink-body layout:mt-0">
          {KIND_LABEL[lead.kind]}
          <span className="block truncate text-xs text-ink-muted">
            Listing {lead.listingId.slice(0, 8)}
          </span>
        </p>
        <p className="mt-1 text-sm text-ink-muted layout:mt-0">
          <span className="layout:hidden">Received </span>
          <time dateTime={lead.createdAt}>{formatAge(lead.createdAt)}</time>
          <span className="layout:hidden"> ago</span>
        </p>
        <p className="hidden text-right text-sm font-semibold text-ink layout:block" aria-hidden>
          Open
        </p>
      </Link>
    </li>
  );
}

type Phase =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'error'; message: string; forbidden: boolean };

/**
 * The staff lead list (#633). Filters, a stacked card list on a phone, a table-like row list on a
 * wide screen, and a cursor pager. The list is component state only: nothing is stored or cached
 * in the browser, and no lead data goes in the URL.
 */
export default function LeadsList() {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [filters, setFilters] = useState<LeadFilters>({});
  const [filterError, setFilterError] = useState<string | null>(null);
  const [items, setItems] = useState<StaffLeadListItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ status: 'loading' });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  // A response for a superseded filter set must never replace the current list.
  const generation = useRef(0);

  const load = useCallback(async (next: LeadFilters) => {
    const mine = ++generation.current;
    setPhase({ status: 'loading' });
    try {
      const page = await fetchLeads(next);
      if (mine !== generation.current) return;
      setItems(page.results);
      setCursor(page.nextCursor);
      setPhase({ status: 'ready' });
    } catch (e) {
      if (mine !== generation.current) return;
      const err = e instanceof StaffApiError ? e : null;
      setItems([]);
      setCursor(null);
      setPhase({
        status: 'error',
        message: err?.message ?? 'The lead desk could not be reached. Try again.',
        forbidden: err?.failure === 'forbidden',
      });
    }
  }, []);

  useEffect(() => {
    void load(filters);
  }, [filters, load]);

  const apply = (e: React.FormEvent) => {
    e.preventDefault();
    if (draft.listingId.trim() && !UUID.test(draft.listingId.trim())) {
      setFilterError('A listing ID has 36 characters, for example 3f2b8c1e-....');
      return;
    }
    if (draft.from && draft.to && draft.from > draft.to) {
      setFilterError('The "from" day must not be after the "to" day.');
      return;
    }
    setFilterError(null);
    setFilters(toFilters(draft));
  };

  const clear = () => {
    setDraft(EMPTY);
    setFilterError(null);
    setFilters({});
  };

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    const mine = generation.current;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await fetchLeads(filters, cursor);
      if (mine !== generation.current) return;
      setItems((prev) => [...prev, ...page.results]);
      setCursor(page.nextCursor);
    } catch (e) {
      if (mine !== generation.current) return;
      setMoreError(e instanceof StaffApiError ? e.message : 'The next page could not load.');
    } finally {
      setLoadingMore(false);
    }
  };

  const set = (key: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setDraft((d) => ({ ...d, [key]: e.target.value }));

  return (
    <div>
      <h1 className="text-2xl font-bold text-ink">Buyer requests</h1>
      <p className="mt-1 text-sm text-ink-muted">Verify each request before matching.</p>

      <form
        onSubmit={apply}
        className="mt-5 grid grid-cols-1 gap-3 rounded-lg border border-surface-border bg-white p-4 sm:grid-cols-2 layout:grid-cols-5"
        aria-label="Filter requests"
      >
        <Field label="Status">
          <select className={FIELD} value={draft.status} onChange={set('status')}>
            <option value="">All statuses</option>
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Kind">
          <select className={FIELD} value={draft.kind} onChange={set('kind')}>
            <option value="">All kinds</option>
            {INQUIRY_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Received from">
          <input type="date" className={FIELD} value={draft.from} onChange={set('from')} />
        </Field>
        <Field label="Received to">
          <input type="date" className={FIELD} value={draft.to} onChange={set('to')} />
        </Field>
        <Field label="Listing ID">
          <input
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            className={FIELD}
            value={draft.listingId}
            onChange={set('listingId')}
          />
        </Field>
        {filterError && (
          <p role="alert" className="text-sm text-brand-700 sm:col-span-2 layout:col-span-5">
            {filterError}
          </p>
        )}
        <div className="flex gap-2 sm:col-span-2 layout:col-span-5">
          <Button type="submit" className="min-h-11 flex-1 sm:flex-none">
            Apply filters
          </Button>
          <Button type="button" variant="secondary" className="min-h-11" onClick={clear}>
            Clear
          </Button>
        </div>
      </form>

      <div className="mt-5" aria-live="polite">
        {phase.status === 'loading' && <LeadsListSkeleton />}

        {phase.status === 'error' && (
          <div role="alert" className="rounded-lg bg-surface-alt px-4 py-8 text-center">
            <p className="text-sm text-ink">{phase.message}</p>
            {!phase.forbidden && (
              <Button
                variant="secondary"
                className="mt-4 min-h-11"
                onClick={() => void load(filters)}
              >
                Try again
              </Button>
            )}
          </div>
        )}

        {phase.status === 'ready' && items.length === 0 && (
          <div className="rounded-lg bg-surface-alt px-4 py-12 text-center">
            <p className="text-sm text-ink">No requests match these filters.</p>
          </div>
        )}

        {phase.status === 'ready' && items.length > 0 && (
          <>
            <div
              className={`hidden px-4 pb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted ${LEAD_ROW_GRID}`}
              aria-hidden
            >
              <span>Requester</span>
              <span>Contact</span>
              <span>Kind and listing</span>
              <span>Age</span>
              <span />
            </div>
            <ul className="space-y-3 layout:space-y-0 layout:divide-y layout:divide-surface-border layout:rounded-lg layout:border layout:border-surface-border layout:bg-white">
              {items.map((lead) => (
                <LeadRow key={lead.id} lead={lead} />
              ))}
            </ul>
            {moreError && (
              <p role="alert" className="mt-3 text-center text-sm text-brand-700">
                {moreError}
              </p>
            )}
            {cursor && (
              <div className="mt-4 flex justify-center">
                <Button
                  variant="secondary"
                  className="min-h-11 w-full sm:w-auto"
                  isLoading={loadingMore}
                  onClick={() => void loadMore()}
                >
                  Load more
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
