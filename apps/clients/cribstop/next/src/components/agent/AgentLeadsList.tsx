'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { AgentLeadListItem } from '@cribstop/property-contracts';
import Button from '@/components/Button';
import { StatusBadge } from '@/components/staff/LeadBadges';
import { acceptLead, fetchAgentLeads } from '@/lib/api/agent-leads';
import { StaffApiError } from '@/lib/api/staff-leads';
import { formatPrice, sortLeads } from '@/lib/agent-leads';
import { formatAge, KIND_LABEL } from '@/lib/staff-leads';
import { AgentLeadsSkeleton } from './AgentSkeletons';
import DeclineSheet from './DeclineSheet';

const LINK =
  'inline-flex min-h-11 items-center font-semibold text-ink underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink';

type Phase = { status: 'loading' } | { status: 'ready' } | { status: 'error'; message: string };

function LeadCard({
  lead,
  busy,
  onAccept,
  onDecline,
}: {
  lead: AgentLeadListItem;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const isNew = lead.status === 'assigned';
  return (
    <li className="rounded-lg border border-surface-border bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={lead.status} />
          <span className="text-xs text-ink-muted">{KIND_LABEL[lead.kind]}</span>
        </div>
        <p className="text-xs text-ink-muted">
          <time dateTime={lead.assignedAt}>{formatAge(lead.assignedAt)}</time> ago
        </p>
      </div>
      <Link
        href={`/agent/leads/${lead.id}`}
        className="mt-3 block min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
      >
        <p className="break-words text-sm font-semibold text-ink">{lead.listing.title}</p>
        <p className="break-words text-sm text-ink-body">{lead.listing.address}</p>
        <p className="text-sm text-ink-muted">{formatPrice(lead.listing.listPrice)}</p>
        <p className="mt-1 truncate text-sm text-ink-muted">
          {lead.emailMasked}
          {lead.phoneMasked ? ` · ${lead.phoneMasked}` : ''}
        </p>
      </Link>
      {isNew && (
        <div className="mt-3 flex gap-2">
          <Button className="min-h-11 flex-1" isLoading={busy} onClick={onAccept}>
            Accept
          </Button>
          <Button
            variant="secondary"
            className="min-h-11 flex-1"
            disabled={busy}
            onClick={onDecline}
          >
            Decline
          </Button>
        </div>
      )}
    </li>
  );
}

/**
 * The agent "My leads" list (#637). New assignments come first. Accept and Decline sit on the
 * card of an assigned lead. Contact stays masked here. The list is component state only.
 */
export default function AgentLeadsList() {
  const [items, setItems] = useState<AgentLeadListItem[]>([]);
  const [phase, setPhase] = useState<Phase>({ status: 'loading' });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [declineId, setDeclineId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async (silent: boolean) => {
    if (!silent) setPhase({ status: 'loading' });
    try {
      const page = await fetchAgentLeads();
      setItems(sortLeads(page.results));
      setPhase({ status: 'ready' });
    } catch (e) {
      if (silent) return;
      setPhase({
        status: 'error',
        message: e instanceof StaffApiError ? e.message : 'Your leads could not load. Try again.',
      });
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const accept = async (id: string) => {
    setBusyId(id);
    setActionError(null);
    try {
      await acceptLead(id);
      await load(true);
    } catch (e) {
      setActionError(e instanceof StaffApiError ? e.message : 'The accept failed. Try again.');
      // The lead may have moved. A fresh list shows the real state.
      if (e instanceof StaffApiError && e.failure !== 'unavailable') await load(true);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-ink">My leads</h1>
      <p className="mt-1 text-sm text-ink-muted">
        New assignments come first. Accept to see contact details.
      </p>

      <div className="mt-5" aria-live="polite">
        {phase.status === 'loading' && <AgentLeadsSkeleton />}

        {phase.status === 'error' && (
          <div role="alert" className="rounded-lg bg-surface-alt px-4 py-8 text-center">
            <p className="text-sm text-ink">{phase.message}</p>
            <Button variant="secondary" className="mt-4 min-h-11" onClick={() => void load(false)}>
              Try again
            </Button>
          </div>
        )}

        {phase.status === 'ready' && (
          <>
            {actionError && (
              <p
                role="alert"
                className="mb-3 rounded-md bg-brand-50 px-3 py-2 text-sm text-brand-900"
              >
                {actionError}
              </p>
            )}
            {items.length === 0 ? (
              <div className="rounded-lg bg-surface-alt px-4 py-12 text-center">
                <p className="text-sm text-ink">No leads are assigned to you yet.</p>
                <p className="mt-1 text-sm text-ink-muted">Open this page again to check.</p>
              </div>
            ) : (
              <ul className="space-y-3">
                {items.map((lead) => (
                  <LeadCard
                    key={lead.id}
                    lead={lead}
                    busy={busyId === lead.id}
                    onAccept={() => void accept(lead.id)}
                    onDecline={() => setDeclineId(lead.id)}
                  />
                ))}
              </ul>
            )}
            <div className="mt-4">
              <Link href="/" className={LINK}>
                Back to Cribstop
              </Link>
            </div>
          </>
        )}
      </div>

      {declineId && (
        <DeclineSheet
          leadId={declineId}
          onClose={() => setDeclineId(null)}
          onDone={() => {
            setDeclineId(null);
            void load(true);
          }}
        />
      )}
    </div>
  );
}
