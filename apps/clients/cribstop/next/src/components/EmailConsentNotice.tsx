'use client';

import { useQuery } from '@tanstack/react-query';
import type { ConsentWording } from '@/lib/api/notification-preferences';
import { consentWordingOptions } from '@/lib/query/account';

/**
 * Loads the server-held email consent wording once `active` is true. The save handler sends only
 * the wording id. A user must see the text before the opt-in goes out.
 */
export function useConsentWording(active: boolean) {
  const { data, isError } = useQuery({ ...consentWordingOptions(), enabled: active });
  return { wording: data ?? null, failed: isError };
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
