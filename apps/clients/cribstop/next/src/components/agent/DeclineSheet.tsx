'use client';

import { useState } from 'react';
import { AGENT_DECLINE_REASONS, type AgentDeclineReason } from '@cribstop/property-contracts';
import Button from '@/components/Button';
import Modal from '@/components/Modal';
import { declineLead } from '@/lib/api/agent-leads';
import { StaffApiError } from '@/lib/api/staff-leads';
import { DECLINE_REASON_LABEL } from '@/lib/agent-leads';

/** The decline reason picker. The list is fixed, so a reason cannot hold a trait of the buyer. */
export default function DeclineSheet({
  leadId,
  onClose,
  onDone,
}: {
  leadId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState<AgentDeclineReason | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!reason || busy) return;
    setBusy(true);
    setError(null);
    try {
      await declineLead(leadId, reason);
      onDone();
    } catch (e) {
      setError(e instanceof StaffApiError ? e.message : 'The decline failed. Try again.');
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Decline this lead" mobileStyle="bottom-sheet">
      <div className="space-y-4 pb-[env(safe-area-inset-bottom)]">
        {error && (
          <p role="alert" className="rounded-md bg-brand-50 px-3 py-2 text-sm text-brand-900">
            {error}
          </p>
        )}
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-semibold text-ink">Why are you declining?</legend>
          {AGENT_DECLINE_REASONS.map((r) => (
            <label
              key={r}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-surface-border px-3 text-sm text-ink has-[:checked]:border-ink"
            >
              <input
                type="radio"
                name="decline-reason"
                value={r}
                checked={reason === r}
                onChange={() => setReason(r)}
                className="h-4 w-4"
              />
              {DECLINE_REASON_LABEL[r]}
            </label>
          ))}
        </fieldset>
        <div className="flex gap-2">
          <Button variant="secondary" className="min-h-11 flex-1" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="min-h-11 flex-1"
            disabled={!reason}
            isLoading={busy}
            onClick={() => void submit()}
          >
            Decline lead
          </Button>
        </div>
      </div>
    </Modal>
  );
}
