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
  // The server cannot read the opt-out, so the switch stays off and disabled until mounted.
  const [mounted, setMounted] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [gpc, setGpc] = useState(false);
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    const sync = () => {
      setEnabled(isPersonalisationEnabled());
      setGpc(isGpcOn());
      if (isGpcOn()) clearFeedProfile();
    };
    sync();
    setMounted(true);
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
          disabled={gpc || !mounted}
          aria-describedby={gpc ? 'personalise-gpc-note' : undefined}
          onChange={(e) => setPersonalisation(e.target.checked)}
        />
        <span>Personalise my home page</span>
      </label>
      {gpc && (
        <p id="personalise-gpc-note" className="text-xs text-ink-muted">
          Your browser sends Global Privacy Control, so we do not save or use your browsing for
          personalisation.
        </p>
      )}
      <button
        type="button"
        className="min-h-[44px] text-left underline hover:text-ink"
        onClick={() => {
          clearFeedProfile();
          try {
            window.localStorage.removeItem('recentSearches');
          } catch {
            // Storage is blocked. There is nothing to clear.
          }
          setCleared(true);
        }}
      >
        Clear browsing history
      </button>
      <p role="status" className="text-xs text-ink-muted">
        {cleared ? 'Browsing history cleared.' : ''}
      </p>
    </div>
  );
}
