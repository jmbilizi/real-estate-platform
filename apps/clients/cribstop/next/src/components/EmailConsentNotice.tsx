'use client';

import { useEffect, useState } from 'react';
import {
  type ConsentWording,
  getNotificationPreferences,
} from '@/lib/api/notification-preferences';

/**
 * Loads the server-held email consent wording once `active` is true. The save handler sends only
 * the wording id. A user must see the text before the opt-in goes out.
 */
export function useConsentWording(active: boolean) {
  const [wording, setWording] = useState<ConsentWording | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!active || wording) return;
    let cancelled = false;
    setFailed(false);
    getNotificationPreferences()
      .then((p) => {
        if (!cancelled) setWording(p.consentWording);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [active, wording]);

  return { wording, failed };
}

export default function EmailConsentNotice({
  wording,
  failed,
}: {
  wording: ConsentWording | null;
  failed: boolean;
}) {
  return (
    <p
      role="note"
      data-testid="email-consent-wording"
      className="mt-2 rounded-xl bg-surface-alt px-3 py-2 text-xs leading-relaxed text-ink-muted break-words"
    >
      {failed
        ? 'We could not load the consent wording. Reload the page to turn on email.'
        : (wording?.text ?? 'Loading…')}
    </p>
  );
}
