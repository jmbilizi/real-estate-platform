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
/**
 * `inline` (#1048) lays the switch and the clear button out on one row, for the footer bottom bar.
 * Each control keeps a 44px hit area.
 */
export default function PersonaliseSwitch({ inline = false }: { inline?: boolean }) {
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
    <div className={inline ? 'flex flex-wrap items-center gap-x-4 text-xs' : 'text-[15px]'}>
      <label className={`flex min-h-[44px] items-center ${inline ? 'gap-2' : 'gap-3'}`}>
        <input
          type="checkbox"
          role="switch"
          className={`shrink-0 accent-brand ${inline ? 'h-4 w-4' : 'h-5 w-5'}`}
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
        className="min-h-[44px] text-left text-ink-muted underline underline-offset-2 hover:text-ink"
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
      <p
        role="status"
        className={inline ? 'empty:sr-only text-ink-muted' : 'text-xs text-ink-muted'}
      >
        {cleared ? 'Browsing history cleared.' : ''}
      </p>
    </div>
  );
}
