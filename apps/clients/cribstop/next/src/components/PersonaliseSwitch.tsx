'use client';

import { useEffect, useState } from 'react';
import {
  clearFeedProfile,
  isGpcOn,
  isPersonalisationEnabled,
  PERSONALISE_EVENT,
  setPersonalisation,
} from '@/lib/feed-profile';

/** Switch and clear button for the local feed profile (#833). Used in the footer and account page. */
export default function PersonaliseSwitch() {
  const [enabled, setEnabled] = useState(true);
  const [gpc, setGpc] = useState(false);
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    const sync = () => {
      setEnabled(isPersonalisationEnabled());
      setGpc(isGpcOn());
    };
    sync();
    window.addEventListener(PERSONALISE_EVENT, sync);
    return () => window.removeEventListener(PERSONALISE_EVENT, sync);
  }, []);

  return (
    <div className="space-y-2 text-sm">
      <label className="flex min-h-[44px] items-center gap-3">
        <input
          type="checkbox"
          role="switch"
          className="h-5 w-5 shrink-0"
          checked={enabled}
          disabled={gpc}
          onChange={(e) => setPersonalisation(e.target.checked)}
        />
        <span>Personalise my home page</span>
      </label>
      {gpc && (
        <p className="text-xs text-ink-muted">
          Your browser sends Global Privacy Control. Personalisation stays off.
        </p>
      )}
      <button
        type="button"
        className="min-h-[44px] text-left underline hover:text-ink"
        onClick={() => {
          clearFeedProfile();
          setCleared(true);
        }}
      >
        Clear browsing history
      </button>
      {cleared && (
        <p role="status" className="text-xs text-ink-muted">
          Browsing history cleared.
        </p>
      )}
    </div>
  );
}
