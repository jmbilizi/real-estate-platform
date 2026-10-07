'use client';

import { useEffect, useState } from 'react';
import type { AgentProfile, StaffLeadDetail } from '@cribstop/property-contracts';
import Button from '@/components/Button';
import Modal from '@/components/Modal';
import { fetchAgents } from '@/lib/api/staff-agents';
import { assignLead, StaffApiError, unassignLead } from '@/lib/api/staff-leads';
import { ErrorLine, NoteField } from './StaffFields';
import { AgentPickerSkeleton } from './LeadSkeletons';

interface SheetProps {
  lead: StaffLeadDetail;
  onClose: () => void;
  onDone: () => void;
  /** The status moved under the caller. The parent reloads the lead. */
  onConflict: () => void;
}

type Load =
  | { status: 'loading' }
  | { status: 'ready'; agents: AgentProfile[] }
  | { status: 'error'; message: string };

/**
 * Assign a verified lead. The picker lists only active agents licensed in the listing's state.
 * The request carries the agent and nothing else: no reason field (Fair Housing, PRD §6).
 */
export function AssignAgentSheet({ lead, onClose, onDone, onConflict }: SheetProps) {
  const state = lead.listing.state;
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!state) return;
    let live = true;
    fetchAgents({ active: 'true', licenceState: state })
      .then((agents) => {
        // The service filters. This guard keeps a stale or wrong reply out of the picker.
        const eligible = agents.filter((a) => a.active && a.licenceStates.includes(state));
        if (live) setLoad({ status: 'ready', agents: eligible });
      })
      .catch((e) => {
        if (live)
          setLoad({
            status: 'error',
            message: e instanceof StaffApiError ? e.message : 'The agents could not load.',
          });
      });
    return () => {
      live = false;
    };
  }, [state]);

  const submit = async () => {
    if (!picked || busy) return;
    setBusy(true);
    setError(null);
    try {
      await assignLead(lead.id, picked);
      onDone();
    } catch (e) {
      setError(e instanceof StaffApiError ? e.message : 'The assignment failed. Try again.');
      if (e instanceof StaffApiError && e.failure === 'conflict') onConflict();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Assign agent" mobileStyle="bottom-sheet">
      <div className="space-y-4 pb-[env(safe-area-inset-bottom)]">
        <ErrorLine message={error} />
        {!state && (
          <p className="text-sm text-ink-body">
            This listing has no state on record, so no agent can be matched.
          </p>
        )}
        {state && load.status === 'loading' && <AgentPickerSkeleton />}
        {state && load.status === 'error' && (
          <p role="alert" className="text-sm text-brand-700">
            {load.message}
          </p>
        )}
        {state && load.status === 'ready' && load.agents.length === 0 && (
          <p className="text-sm text-ink-body">
            No active agent is licensed in {state}. Add or reactivate an agent first.
          </p>
        )}
        {state && load.status === 'ready' && load.agents.length > 0 && (
          <fieldset className="min-w-0">
            <legend className="mb-2 text-sm text-ink-body">
              Active agents licensed in {state}
            </legend>
            <ul className="space-y-2">
              {load.agents.map((a) => (
                <li key={a.id}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-surface-border bg-white px-3 py-2 has-[:checked]:border-ink has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ink">
                    <input
                      type="radio"
                      name="agent"
                      className="size-5 shrink-0 accent-ink"
                      checked={picked === a.id}
                      onChange={() => setPicked(a.id)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">
                        {a.displayName}
                      </span>
                      <span className="block truncate text-xs text-ink-muted">
                        Licensed in {a.licenceStates.join(', ')}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        )}
        <div className="flex gap-2">
          <Button variant="secondary" className="min-h-11 flex-1" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="min-h-11 flex-1"
            disabled={!picked}
            isLoading={busy}
            onClick={() => void submit()}
          >
            Assign
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Unassign an assigned or accepted lead. A note is required. The lead goes back to `verified`. */
export function UnassignSheet({ lead, onClose, onDone, onConflict }: SheetProps) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const text = note.trim();
    if (!text) {
      setError('Add a note. A note is required to unassign.');
      return;
    }
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await unassignLead(lead.id, text);
      onDone();
    } catch (e) {
      setError(e instanceof StaffApiError ? e.message : 'The action failed. Try again.');
      if (e instanceof StaffApiError && e.failure === 'conflict') onConflict();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Unassign agent" mobileStyle="bottom-sheet">
      <div className="space-y-4 pb-[env(safe-area-inset-bottom)]">
        <ErrorLine message={error} />
        <NoteField id="unassign-note" label="Note" required value={note} onChange={setNote} />
        <div className="flex gap-2">
          <Button variant="secondary" className="min-h-11 flex-1" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button className="min-h-11 flex-1" isLoading={busy} onClick={() => void submit()}>
            Unassign
          </Button>
        </div>
      </div>
    </Modal>
  );
}
