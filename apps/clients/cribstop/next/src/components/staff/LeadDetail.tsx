'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { StaffLeadDetail } from '@cribstop/property-contracts';
import { STAFF_NOTE_MAX_LENGTH } from '@cribstop/property-contracts';
import Button from '@/components/Button';
import Modal from '@/components/Modal';
import { addLeadNote, fetchLead, StaffApiError, transitionLead } from '@/lib/api/staff-leads';
import { PRICE_WITHHELD_COPY } from '@/lib/listing-format';
import {
  ACTION_LABEL,
  actionsFor,
  formatDateTime,
  KIND_LABEL,
  NOTE_HINT,
  noteRequired,
  type StaffAction,
  STATUS_LABEL,
  telHref,
} from '@/lib/staff-leads';
import { DuplicateBadge, StatusBadge, VerifiedAccountBadge } from './LeadBadges';
import { LeadDetailSkeleton } from './LeadSkeletons';

const FIELD =
  'w-full rounded-md border border-surface-border bg-white px-3 py-2.5 text-sm text-ink focus:border-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-ink';
const LINK =
  'inline-flex min-h-11 items-center font-semibold text-ink underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-surface-border bg-white p-4 sm:p-5">
      <h2 className="mb-3 text-base font-bold text-ink">{title}</h2>
      {children}
    </section>
  );
}

function NoteField({
  id,
  value,
  onChange,
  required,
  label,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  label: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-semibold text-ink">
        {label}
        {required && <span className="font-normal text-ink-muted"> (required)</span>}
      </label>
      <textarea
        id={id}
        rows={4}
        maxLength={STAFF_NOTE_MAX_LENGTH}
        className={FIELD}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={`${id}-hint`}
      />
      <p id={`${id}-hint`} className="mt-1 text-xs text-ink-muted">
        {NOTE_HINT}
      </p>
    </div>
  );
}

function ActionSheet({
  lead,
  onClose,
  onDone,
  onConflict,
}: {
  lead: StaffLeadDetail;
  onClose: () => void;
  onDone: () => void;
  onConflict: () => void;
}) {
  const [action, setAction] = useState<StaffAction | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const actions = actionsFor(lead.status);

  const submit = async () => {
    if (!action || busy) return;
    const text = note.trim();
    if (noteRequired(action) && !text) {
      setError('Add a note. A note is required for this action.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await transitionLead(lead.id, action, text || undefined);
      onDone();
    } catch (e) {
      setError(e instanceof StaffApiError ? e.message : 'The action failed. Try again.');
      if (e instanceof StaffApiError && e.failure === 'conflict') {
        // The status moved under us. Reload so the offered actions match the new status.
        setAction(null);
        setNote('');
        onConflict();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Take action" mobileStyle="bottom-sheet">
      <div className="space-y-4 pb-[env(safe-area-inset-bottom)]">
        {error && (
          <p role="alert" className="rounded-md bg-brand-50 px-3 py-2 text-sm text-brand-900">
            {error}
          </p>
        )}
        {actions.length === 0 && (
          <p className="text-sm text-ink-body">
            No action is available while this request is {STATUS_LABEL[lead.status].toLowerCase()}.
          </p>
        )}
        {!action &&
          actions.map((a) => (
            <Button
              key={a}
              variant={a === 'verified' ? 'primary' : 'secondary'}
              className="min-h-11 w-full"
              onClick={() => {
                setAction(a);
                setError(null);
              }}
            >
              {ACTION_LABEL[a]}
            </Button>
          ))}
        {action && (
          <>
            <p className="text-sm font-semibold text-ink">{ACTION_LABEL[action]}</p>
            <NoteField
              id="transition-note"
              label="Note"
              required={noteRequired(action)}
              value={note}
              onChange={setNote}
            />
            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="min-h-11 flex-1"
                disabled={busy}
                onClick={() => {
                  setAction(null);
                  setError(null);
                }}
              >
                Back
              </Button>
              <Button className="min-h-11 flex-1" isLoading={busy} onClick={() => void submit()}>
                Confirm
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

type Phase =
  | { status: 'loading' }
  | { status: 'ready'; lead: StaffLeadDetail }
  | { status: 'error'; message: string; notFound: boolean };

/**
 * The staff lead detail (#633). Full contact, consent, status history, notes and the moderation
 * actions. The view is component state only. It is dropped on unmount. Opening a lead writes an
 * audit row in the service, so a reload that is not needed is avoided: a note is added to the view
 * from the API reply, and only a status change reloads the lead.
 */
export default function LeadDetail({ id }: { id: string }) {
  const [phase, setPhase] = useState<Phase>({ status: 'loading' });
  const [sheetOpen, setSheetOpen] = useState(false);
  const [note, setNote] = useState('');
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const loaded = useRef(false);

  const load = useCallback(
    async (silent: boolean) => {
      if (!silent) setPhase({ status: 'loading' });
      try {
        const lead = await fetchLead(id);
        loaded.current = true;
        setPhase({ status: 'ready', lead });
      } catch (e) {
        if (silent && loaded.current) return;
        const err = e instanceof StaffApiError ? e : null;
        setPhase({
          status: 'error',
          message: err?.message ?? 'The request could not load. Try again.',
          notFound: err?.failure === 'not_found' || err?.failure === 'forbidden',
        });
      }
    },
    [id],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  if (phase.status === 'loading') return <LeadDetailSkeleton />;

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
          <Link href="/admin/leads" className={LINK}>
            All requests
          </Link>
        </div>
      </div>
    );
  }

  const { lead } = phase;
  const actions = actionsFor(lead.status);

  const addNote = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = note.trim();
    if (!text) {
      setNoteError('Write a note first.');
      return;
    }
    setNoteBusy(true);
    setNoteError(null);
    try {
      const created = await addLeadNote(lead.id, text);
      setPhase({ status: 'ready', lead: { ...lead, notes: [...lead.notes, created] } });
      setNote('');
    } catch (err) {
      setNoteError(err instanceof StaffApiError ? err.message : 'The note was not saved.');
    } finally {
      setNoteBusy(false);
    }
  };

  const price =
    lead.listing.listPrice === null
      ? PRICE_WITHHELD_COPY
      : new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
          maximumFractionDigits: 0,
        }).format(lead.listing.listPrice);

  return (
    <div className="space-y-4 pb-24 layout:pb-0">
      <Link href="/admin/leads" className={LINK}>
        ← All requests
      </Link>

      <header>
        <h1 className="break-words text-2xl font-bold text-ink">{lead.name}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <StatusBadge status={lead.status} />
          {lead.possibleDuplicate && <DuplicateBadge />}
          {lead.verifiedAccount && <VerifiedAccountBadge />}
          <span className="text-sm text-ink-muted">
            {KIND_LABEL[lead.kind]} · {formatDateTime(lead.createdAt)}
          </span>
        </div>
        {actions.length > 0 && (
          <Button
            className="mt-4 hidden min-h-11 layout:inline-flex"
            onClick={() => setSheetOpen(true)}
          >
            Take action
          </Button>
        )}
      </header>

      <Section title="Contact">
        <dl className="space-y-1 text-sm">
          <div>
            <dt className="text-ink-muted">Email</dt>
            <dd className="break-all">
              <a href={`mailto:${lead.email}`} className={LINK}>
                {lead.email}
              </a>
            </dd>
          </div>
          <div>
            <dt className="text-ink-muted">Phone</dt>
            <dd>
              {lead.phone ? (
                <a href={telHref(lead.phone)} className={LINK}>
                  {lead.phone}
                </a>
              ) : (
                'No phone given'
              )}
            </dd>
          </div>
        </dl>
      </Section>

      <Section title="Request">
        {lead.message ? (
          <p className="whitespace-pre-wrap break-words text-sm text-ink-body">{lead.message}</p>
        ) : (
          <p className="text-sm text-ink-muted">No message.</p>
        )}
        <div className="mt-4 border-t border-surface-border pt-3 text-sm">
          <p className="font-semibold text-ink">{lead.listing.title}</p>
          <p className="text-ink-body">{lead.listing.address}</p>
          <p className="text-ink-body">
            {price}
            {lead.listing.status ? ` · ${lead.listing.status}` : ''}
          </p>
          <Link href={`/listing/${lead.listing.id}`} className={LINK}>
            View listing
          </Link>
        </div>
      </Section>

      <Section title="Consent">
        {lead.consent.given ? (
          <dl className="space-y-1 text-sm text-ink-body">
            <div>
              <dt className="inline text-ink-muted">Given: </dt>
              <dd className="inline">
                {lead.consent.givenAt ? formatDateTime(lead.consent.givenAt) : 'Time not recorded'}
              </dd>
            </div>
            <div>
              <dt className="inline text-ink-muted">Text version: </dt>
              <dd className="inline">{lead.consent.textVersion ?? 'Not recorded'}</dd>
            </div>
            <div>
              <dt className="inline text-ink-muted">Channels: </dt>
              <dd className="inline">
                {lead.consent.channels.length ? lead.consent.channels.join(', ') : 'None'}
              </dd>
            </div>
            {lead.consent.text && (
              <p className="mt-2 rounded-md bg-surface-alt p-3 text-xs">{lead.consent.text}</p>
            )}
          </dl>
        ) : (
          <p className="text-sm text-ink-muted">No consent to contact was given.</p>
        )}
      </Section>

      {lead.duplicateLeadIds.length > 0 && (
        <Section title="Possible duplicates">
          <p className="mb-2 text-sm text-ink-body">
            These open requests share this email or phone, on the same listing, within seven days.
          </p>
          <ul>
            {lead.duplicateLeadIds.map((dupId) => (
              <li key={dupId}>
                <Link href={`/admin/leads/${dupId}`} className={LINK}>
                  Request {dupId.slice(0, 8)}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Status history">
        <ol className="space-y-3 border-l-2 border-surface-border pl-4">
          {lead.history.map((ev) => (
            <li key={ev.id} className="text-sm">
              <p className="font-semibold text-ink">
                {ev.fromStatus ? `${STATUS_LABEL[ev.fromStatus]} to ` : ''}
                {STATUS_LABEL[ev.toStatus]}
              </p>
              <p className="text-ink-muted">
                <time dateTime={ev.createdAt}>{formatDateTime(ev.createdAt)}</time> · {ev.actorRole}
              </p>
              {ev.note && (
                <p className="mt-1 whitespace-pre-wrap break-words text-ink-body">{ev.note}</p>
              )}
            </li>
          ))}
        </ol>
      </Section>

      <Section title="Notes">
        {lead.notes.length === 0 ? (
          <p className="text-sm text-ink-muted">No notes yet.</p>
        ) : (
          <ul className="mb-4 space-y-3">
            {lead.notes.map((n) => (
              <li key={n.id} className="rounded-md bg-surface-alt p-3 text-sm">
                <p className="whitespace-pre-wrap break-words text-ink">{n.body}</p>
                <p className="mt-1 text-xs text-ink-muted">
                  <time dateTime={n.createdAt}>{formatDateTime(n.createdAt)}</time> · {n.authorRole}
                </p>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={addNote} className="space-y-3">
          <NoteField id="add-note" label="Add a note" value={note} onChange={setNote} />
          {noteError && (
            <p role="alert" className="text-sm text-brand-700">
              {noteError}
            </p>
          )}
          <Button type="submit" variant="secondary" className="min-h-11" isLoading={noteBusy}>
            Add note
          </Button>
        </form>
      </Section>

      {actions.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-chrome border-t border-surface-border bg-white px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 layout:hidden">
          <Button className="min-h-11 w-full" onClick={() => setSheetOpen(true)}>
            Take action
          </Button>
        </div>
      )}

      {sheetOpen && (
        <ActionSheet
          lead={lead}
          onClose={() => setSheetOpen(false)}
          onConflict={() => void load(true)}
          onDone={() => {
            setSheetOpen(false);
            void load(true);
          }}
        />
      )}
    </div>
  );
}
