'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AGENT_NOTE_MAX_LENGTH, type AgentLeadDetail } from '@cribstop/property-contracts';
import Button from '@/components/Button';
import { StatusBadge } from '@/components/staff/LeadBadges';
import { acceptLead, fetchAgentLead, setLeadStatus } from '@/lib/api/agent-leads';
import { StaffApiError } from '@/lib/api/staff-leads';
import {
  AGENT_NOTE_HINT,
  type AgentTarget,
  formatPrice,
  nextTargets,
  STEPS,
  TARGET_LABEL,
  TOUR_REMINDER,
} from '@/lib/agent-leads';
import { formatDateTime, KIND_LABEL, STATUS_LABEL, telHref } from '@/lib/staff-leads';
import { AgentLeadDetailSkeleton } from './AgentSkeletons';
import DeclineSheet from './DeclineSheet';

const LINK =
  'inline-flex min-h-11 items-center font-semibold text-ink underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink';
const CONTACT_BTN =
  'inline-flex min-h-11 flex-1 items-center justify-center rounded-md border border-ink px-4 text-sm font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-surface-border bg-white p-4 sm:p-5">
      <h2 className="mb-3 text-base font-bold text-ink">{title}</h2>
      {children}
    </section>
  );
}

/** Where the lead stands among the steps. A lost lead shows no step as reached past its last. */
function Stepper({ status }: { status: AgentLeadDetail['status'] }) {
  const at = STEPS.indexOf(status as AgentTarget);
  return (
    <ol className="mb-4 grid grid-cols-4 gap-1 text-center text-xs" aria-label="Progress">
      {STEPS.map((s, i) => (
        <li
          key={s}
          aria-current={i === at ? 'step' : undefined}
          className={`rounded-md px-1 py-2 font-semibold ${i <= at ? 'bg-ink text-white' : 'bg-surface-soft text-ink-muted'}`}
        >
          {TARGET_LABEL[s]}
        </li>
      ))}
    </ol>
  );
}

type Phase =
  | { status: 'loading' }
  | { status: 'ready'; lead: AgentLeadDetail }
  | { status: 'error'; message: string; notFound: boolean };

/**
 * The agent lead detail (#637). Before accept: masked contact, Accept and Decline. After accept:
 * full contact with tap to call and email, allowed status steps only, and the timeline.
 * The view is component state only and is dropped on unmount.
 */
export default function AgentLeadDetailView({ id }: { id: string }) {
  const [phase, setPhase] = useState<Phase>({ status: 'loading' });
  const [declineOpen, setDeclineOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const router = useRouter();
  const loaded = useRef(false);

  const load = useCallback(
    async (silent: boolean) => {
      if (!silent) setPhase({ status: 'loading' });
      try {
        const lead = await fetchAgentLead(id);
        loaded.current = true;
        setPhase({ status: 'ready', lead });
      } catch (e) {
        if (silent && loaded.current) return;
        const err = e instanceof StaffApiError ? e : null;
        setPhase({
          status: 'error',
          message: err?.message ?? 'The lead could not load. Try again.',
          notFound: err?.failure === 'not_found' || err?.failure === 'forbidden',
        });
      }
    },
    [id],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  if (phase.status === 'loading') return <AgentLeadDetailSkeleton />;

  if (phase.status === 'error') {
    return (
      <div role="alert" className="rounded-lg bg-surface-alt px-4 py-12 text-center">
        <p className="text-sm text-ink">{phase.message}</p>
        <div className="mt-4 flex justify-center gap-2">
          {!phase.notFound && (
            <Button variant="secondary" className="min-h-11" onClick={() => void load(false)}>
              Try again
            </Button>
          )}
          <Link href="/agent/leads" className={LINK}>
            My leads
          </Link>
        </div>
      </div>
    );
  }

  const { lead } = phase;
  const isAssigned = lead.status === 'assigned';
  const targets = nextTargets(lead.status);

  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await work();
      setNote('');
      await load(true);
    } catch (e) {
      setActionError(e instanceof StaffApiError ? e.message : 'The action failed. Try again.');
      // The lead may have moved under us. Reload so the offered actions match.
      if (e instanceof StaffApiError && e.failure !== 'unavailable') await load(true);
    } finally {
      setBusy(false);
    }
  };

  const timeline = [
    { label: 'Request received', at: lead.createdAt },
    { label: 'Assigned to you', at: lead.assignedAt },
    ...(lead.acceptedAt ? [{ label: 'You accepted', at: lead.acceptedAt }] : []),
  ];

  return (
    <div className="space-y-4 pb-24 layout:pb-0">
      <Link href="/agent/leads" className={LINK}>
        ← My leads
      </Link>

      <header>
        <h1 className="break-words text-2xl font-bold text-ink">{lead.listing.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <StatusBadge status={lead.status} />
          <span className="text-sm text-ink-muted">
            {KIND_LABEL[lead.kind]} · {formatDateTime(lead.createdAt)}
          </span>
        </div>
      </header>

      {actionError && (
        <p role="alert" className="rounded-md bg-brand-50 px-3 py-2 text-sm text-brand-900">
          {actionError}
        </p>
      )}

      {isAssigned && (
        <div className="hidden gap-2 layout:flex">
          <Button
            className="min-h-11"
            isLoading={busy}
            onClick={() => void run(() => acceptLead(lead.id))}
          >
            Accept
          </Button>
          <Button
            variant="secondary"
            className="min-h-11"
            disabled={busy}
            onClick={() => setDeclineOpen(true)}
          >
            Decline
          </Button>
        </div>
      )}

      <Section title="Contact">
        {lead.contact ? (
          <>
            <p className="break-words text-base font-semibold text-ink">{lead.contact.name}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {lead.contact.phone && (
                <a href={telHref(lead.contact.phone)} className={CONTACT_BTN}>
                  Call {lead.contact.phone}
                </a>
              )}
              <a href={`mailto:${lead.contact.email}`} className={`${CONTACT_BTN} break-all`}>
                Email {lead.contact.email}
              </a>
            </div>
            {lead.contact.consent.given ? (
              <div className="mt-3 text-sm text-ink-body">
                <p>
                  <span className="text-ink-muted">Consented channels: </span>
                  {lead.contact.consent.channels.length
                    ? lead.contact.consent.channels.join(', ')
                    : 'None recorded'}
                  {lead.contact.consent.givenAt
                    ? ` · ${formatDateTime(lead.contact.consent.givenAt)}`
                    : ''}
                </p>
                {lead.contact.consent.text && (
                  <p className="mt-2 rounded-md bg-surface-alt p-3 text-xs">
                    {lead.contact.consent.text}
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-3 text-sm text-ink-muted">
                The buyer gave no consent to be contacted by call or text. Do not call or text this
                buyer.
              </p>
            )}
          </>
        ) : (
          <>
            <dl className="space-y-1 text-sm text-ink-body">
              <div>
                <dt className="inline text-ink-muted">Email: </dt>
                <dd className="inline break-all">{lead.emailMasked}</dd>
              </div>
              <div>
                <dt className="inline text-ink-muted">Phone: </dt>
                <dd className="inline">{lead.phoneMasked ?? 'No phone given'}</dd>
              </div>
            </dl>
            <p className="mt-3 text-sm text-ink-muted">Accept this lead to see the full contact.</p>
          </>
        )}
      </Section>

      <Section title="Request">
        {lead.contact?.message ? (
          <p className="whitespace-pre-wrap break-words text-sm text-ink-body">
            {lead.contact.message}
          </p>
        ) : (
          lead.contact && <p className="text-sm text-ink-muted">No message.</p>
        )}
        <div
          className={`text-sm ${lead.contact ? 'mt-4 border-t border-surface-border pt-3' : ''}`}
        >
          <p className="font-semibold text-ink">{lead.listing.title}</p>
          <p className="text-ink-body">{lead.listing.address}</p>
          <p className="text-ink-body">
            {formatPrice(lead.listing.listPrice)}
            {lead.listing.status ? ` · ${lead.listing.status}` : ''}
          </p>
          <Link href={`/listing/${lead.listing.id}`} className={LINK}>
            View listing
          </Link>
        </div>
      </Section>

      {targets.length > 0 && (
        <Section title="Update status">
          <Stepper status={lead.status} />
          <label htmlFor="agent-note" className="mb-1 block text-sm font-semibold text-ink">
            Note <span className="font-normal text-ink-muted">(optional)</span>
          </label>
          <textarea
            id="agent-note"
            rows={3}
            maxLength={AGENT_NOTE_MAX_LENGTH}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-describedby="agent-note-hint"
            className="w-full rounded-md border border-surface-border bg-white px-3 py-2.5 text-sm text-ink focus:border-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
          />
          <p id="agent-note-hint" className="mt-1 text-xs text-ink-muted">
            {AGENT_NOTE_HINT}
          </p>
          {targets.includes('touring') && (
            <p className="mt-4 rounded-md bg-surface-alt px-3 py-2 text-sm text-ink-body">
              {TOUR_REMINDER}
            </p>
          )}
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {targets.map((t) => (
              <Button
                key={t}
                variant={t === 'lost' ? 'secondary' : 'primary'}
                className="min-h-11 w-full"
                disabled={busy}
                onClick={() => void run(() => setLeadStatus(lead.id, t, note.trim() || undefined))}
              >
                Mark as {TARGET_LABEL[t].toLowerCase()}
              </Button>
            ))}
          </div>
        </Section>
      )}

      {!isAssigned && targets.length === 0 && (
        <p className="text-sm text-ink-muted">
          This lead is {STATUS_LABEL[lead.status].toLowerCase()}. No more updates are available.
        </p>
      )}

      <Section title="Timeline">
        <ol className="space-y-3 border-l-2 border-surface-border pl-4">
          {timeline.map((ev) => (
            <li key={ev.label} className="text-sm">
              <p className="font-semibold text-ink">{ev.label}</p>
              <p className="text-ink-muted">
                <time dateTime={ev.at}>{formatDateTime(ev.at)}</time>
              </p>
            </li>
          ))}
          {lead.acceptedAt && (
            <li className="text-sm">
              <p className="font-semibold text-ink">Now: {STATUS_LABEL[lead.status]}</p>
            </li>
          )}
        </ol>
      </Section>

      {isAssigned && (
        <div className="fixed inset-x-0 bottom-0 z-chrome flex gap-2 border-t border-surface-border bg-white px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 layout:hidden">
          <Button
            className="min-h-11 flex-1"
            isLoading={busy}
            onClick={() => void run(() => acceptLead(lead.id))}
          >
            Accept
          </Button>
          <Button
            variant="secondary"
            className="min-h-11 flex-1"
            disabled={busy}
            onClick={() => setDeclineOpen(true)}
          >
            Decline
          </Button>
        </div>
      )}

      {declineOpen && (
        <DeclineSheet
          leadId={lead.id}
          onClose={() => setDeclineOpen(false)}
          onDone={() => {
            setDeclineOpen(false);
            // A declined lead leaves the agent's list, so the detail 404s. Go back to the list.
            router.push('/agent/leads');
          }}
        />
      )}
    </div>
  );
}
