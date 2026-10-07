'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AGENT_LICENCE_STATES_MAX,
  type AgentProfile,
  licenceStateSchema,
} from '@cribstop/property-contracts';
import Button from '@/components/Button';
import Modal from '@/components/Modal';
import { type AgentFilters, createAgent, fetchAgents, updateAgent } from '@/lib/api/staff-agents';
import { StaffApiError } from '@/lib/api/staff-leads';
import { AgentsListSkeleton } from './LeadSkeletons';
import { ErrorLine, FIELD_TALL } from './StaffFields';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PILL = 'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold';

/** "md, dc va" becomes `['MD', 'DC', 'VA']`. Repeats go. Validation is the caller's. */
export function parseStates(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\s,]+/)
        .filter(Boolean)
        .map((s) => s.toUpperCase()),
    ),
  ];
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs font-semibold text-ink-body">
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  );
}

interface FormDraft {
  accountId: string;
  displayName: string;
  licenceNumber: string;
  states: string;
  active: boolean;
}

function AgentFormSheet({
  agent,
  onClose,
  onSaved,
}: {
  /** Null creates a profile. */
  agent: AgentProfile | null;
  onClose: () => void;
  onSaved: (saved: AgentProfile) => void;
}) {
  const [draft, setDraft] = useState<FormDraft>({
    accountId: '',
    displayName: agent?.displayName ?? '',
    licenceNumber: agent?.licenceNumber ?? '',
    states: agent?.licenceStates.join(', ') ?? '',
    active: agent?.active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const displayName = draft.displayName.trim();
    const licenceNumber = draft.licenceNumber.trim();
    const licenceStates = parseStates(draft.states);
    if (!agent && !UUID.test(draft.accountId.trim())) {
      return setError('The account ID has 36 characters, for example 3f2b8c1e-....');
    }
    if (!displayName || !licenceNumber) return setError('Enter a name and a licence number.');
    if (licenceStates.length === 0 || licenceStates.length > AGENT_LICENCE_STATES_MAX) {
      return setError('Enter at least one licence state, for example MD, DC, VA.');
    }
    if (!licenceStates.every((s) => licenceStateSchema.safeParse(s).success)) {
      return setError('Use two-letter state codes, for example MD, DC, VA.');
    }
    setBusy(true);
    setError(null);
    try {
      const saved = agent
        ? await updateAgent(agent.id, { displayName, licenceNumber, licenceStates })
        : await createAgent({
            accountId: draft.accountId.trim(),
            displayName,
            licenceNumber,
            licenceStates,
            active: draft.active,
          });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof StaffApiError ? err.message : 'The profile was not saved.');
    } finally {
      setBusy(false);
    }
  };

  const set = (key: keyof FormDraft) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDraft((d) => ({ ...d, [key]: e.target.value }));

  return (
    <Modal
      open
      onClose={onClose}
      title={agent ? 'Edit agent' : 'Add agent'}
      mobileStyle="bottom-sheet"
    >
      <form onSubmit={submit} className="space-y-3 pb-[env(safe-area-inset-bottom)]">
        <ErrorLine message={error} />
        {!agent && (
          <Field label="Account ID">
            <input
              className={FIELD_TALL}
              value={draft.accountId}
              onChange={set('accountId')}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
        )}
        <Field label="Display name">
          <input
            className={FIELD_TALL}
            value={draft.displayName}
            onChange={set('displayName')}
            maxLength={100}
          />
        </Field>
        <Field label="Licence number">
          <input
            className={FIELD_TALL}
            value={draft.licenceNumber}
            onChange={set('licenceNumber')}
            maxLength={40}
          />
        </Field>
        <Field label="Licence states (two letters, separated by commas)">
          <input
            className={FIELD_TALL}
            value={draft.states}
            onChange={set('states')}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        {!agent && (
          <label className="flex min-h-11 items-center gap-3 text-sm text-ink">
            <input
              type="checkbox"
              className="size-5 accent-ink"
              checked={draft.active}
              onChange={(e) => setDraft((d) => ({ ...d, active: e.target.checked }))}
            />
            Active: can receive new requests
          </label>
        )}
        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            className="min-h-11 flex-1"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button type="submit" className="min-h-11 flex-1" isLoading={busy}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function DeactivateSheet({
  agent,
  onClose,
  onSaved,
}: {
  agent: AgentProfile;
  onClose: () => void;
  onSaved: (saved: AgentProfile) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      onSaved(await updateAgent(agent.id, { active: false }));
    } catch (err) {
      setError(err instanceof StaffApiError ? err.message : 'The agent was not deactivated.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="Deactivate agent" mobileStyle="bottom-sheet">
      <div className="space-y-4 pb-[env(safe-area-inset-bottom)]">
        <ErrorLine message={error} />
        <p className="text-sm text-ink-body">
          {agent.displayName} gets no new requests. Open assignments stay.
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" className="min-h-11 flex-1" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button className="min-h-11 flex-1" isLoading={busy} onClick={() => void confirm()}>
            Deactivate
          </Button>
        </div>
      </div>
    </Modal>
  );
}

type Phase =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'error'; message: string; forbidden: boolean };

type Dialog =
  | { kind: 'form'; agent: AgentProfile | null }
  | { kind: 'deactivate'; agent: AgentProfile }
  | null;

/**
 * The agent directory (#635). Admin and SuperAdmin create, edit and deactivate. A Moderator reads
 * the list: `canWrite` hides every write control, and the service refuses a Moderator write too.
 * The list is component state only. Nothing is stored or cached in the browser.
 */
export default function AgentsList({ canWrite }: { canWrite: boolean }) {
  const [activeFilter, setActiveFilter] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [filters, setFilters] = useState<AgentFilters>({});
  const [filterError, setFilterError] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [phase, setPhase] = useState<Phase>({ status: 'loading' });
  const [dialog, setDialog] = useState<Dialog>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // A response for a superseded filter set must never replace the current list.
  const generation = useRef(0);

  const load = useCallback(async (next: AgentFilters) => {
    const mine = ++generation.current;
    setPhase({ status: 'loading' });
    try {
      const rows = await fetchAgents(next);
      if (mine !== generation.current) return;
      setAgents(rows);
      setPhase({ status: 'ready' });
    } catch (e) {
      if (mine !== generation.current) return;
      const err = e instanceof StaffApiError ? e : null;
      setAgents([]);
      setPhase({
        status: 'error',
        message: err?.message ?? 'The agent list could not load. Try again.',
        forbidden: err?.failure === 'forbidden',
      });
    }
  }, []);

  useEffect(() => {
    void load(filters);
  }, [filters, load]);

  const apply = (e: React.FormEvent) => {
    e.preventDefault();
    const state = stateFilter.trim().toUpperCase();
    if (state && !licenceStateSchema.safeParse(state).success) {
      setFilterError('Use a two-letter state code, for example MD.');
      return;
    }
    setFilterError(null);
    setFilters({
      active: (activeFilter || undefined) as AgentFilters['active'],
      licenceState: state || undefined,
    });
  };

  const clear = () => {
    setActiveFilter('');
    setStateFilter('');
    setFilterError(null);
    setFilters({});
  };

  const saved = () => {
    setDialog(null);
    void load(filters);
  };

  const reactivate = async (agent: AgentProfile) => {
    setBusyId(agent.id);
    setRowError(null);
    try {
      await updateAgent(agent.id, { active: true });
      void load(filters);
    } catch (e) {
      setRowError(e instanceof StaffApiError ? e.message : 'The agent was not reactivated.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Agents</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {canWrite
              ? 'Agents match a request by licence state only.'
              : 'You can view the agent directory. An admin changes it.'}
          </p>
        </div>
        {canWrite && (
          <Button className="min-h-11" onClick={() => setDialog({ kind: 'form', agent: null })}>
            Add agent
          </Button>
        )}
      </div>

      <form
        onSubmit={apply}
        aria-label="Filter agents"
        className="mt-5 grid grid-cols-1 gap-3 rounded-lg border border-surface-border bg-white p-4 sm:grid-cols-2 layout:grid-cols-4"
      >
        <Field label="Status">
          <select
            className={FIELD_TALL}
            value={activeFilter}
            onChange={(e) => setActiveFilter(e.target.value)}
          >
            <option value="">All agents</option>
            <option value="true">Active</option>
            <option value="false">Deactivated</option>
          </select>
        </Field>
        <Field label="Licensed in (state)">
          <input
            className={FIELD_TALL}
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
            maxLength={2}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            placeholder="MD"
          />
        </Field>
        {filterError && (
          <p role="alert" className="text-sm text-brand-700 sm:col-span-2 layout:col-span-4">
            {filterError}
          </p>
        )}
        <div className="flex gap-2 sm:col-span-2 layout:col-span-4">
          <Button type="submit" className="min-h-11 flex-1 sm:flex-none">
            Apply filters
          </Button>
          <Button type="button" variant="secondary" className="min-h-11" onClick={clear}>
            Clear
          </Button>
        </div>
      </form>

      <div className="mt-5" aria-live="polite">
        {phase.status === 'loading' && <AgentsListSkeleton />}

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

        {phase.status === 'ready' && agents.length === 0 && (
          <div className="rounded-lg bg-surface-alt px-4 py-12 text-center">
            <p className="text-sm text-ink">No agents match these filters.</p>
          </div>
        )}

        {phase.status === 'ready' && agents.length > 0 && (
          <>
            {rowError && (
              <p role="alert" className="mb-3 text-sm text-brand-700">
                {rowError}
              </p>
            )}
            <ul className="space-y-3">
              {agents.map((a) => (
                <li
                  key={a.id}
                  className="rounded-lg border border-surface-border bg-white p-4 layout:flex layout:items-center layout:gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-semibold text-ink">{a.displayName}</p>
                    <p className="text-xs text-ink-muted">
                      Licence {a.licenceNumber} · {a.licenceStates.join(', ')}
                    </p>
                  </div>
                  <p className="mt-2 layout:mt-0">
                    <span
                      className={`${PILL} ${a.active ? 'bg-emerald-100 text-emerald-900' : 'bg-surface-soft text-ink-body'}`}
                    >
                      {a.active ? 'Active' : 'Deactivated'}
                    </span>
                  </p>
                  {canWrite && (
                    <div className="mt-3 flex gap-2 layout:mt-0">
                      <Button
                        variant="secondary"
                        className="min-h-11 flex-1 layout:flex-none"
                        onClick={() => setDialog({ kind: 'form', agent: a })}
                      >
                        Edit
                      </Button>
                      {a.active ? (
                        <Button
                          variant="secondary"
                          className="min-h-11 flex-1 layout:flex-none"
                          onClick={() => setDialog({ kind: 'deactivate', agent: a })}
                        >
                          Deactivate
                        </Button>
                      ) : (
                        <Button
                          variant="secondary"
                          className="min-h-11 flex-1 layout:flex-none"
                          isLoading={busyId === a.id}
                          onClick={() => void reactivate(a)}
                        >
                          Reactivate
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {canWrite && dialog?.kind === 'form' && (
        <AgentFormSheet
          key={dialog.agent?.id ?? 'new'}
          agent={dialog.agent}
          onClose={() => setDialog(null)}
          onSaved={saved}
        />
      )}
      {canWrite && dialog?.kind === 'deactivate' && (
        <DeactivateSheet agent={dialog.agent} onClose={() => setDialog(null)} onSaved={saved} />
      )}
    </div>
  );
}
