'use client';

import { Check } from 'lucide-react';
import { useWaitlist } from '@/lib/useWaitlist';

const KIND = 'services-provider';

export default function ProviderWaitlistButton() {
  const waitlist = useWaitlist();
  const joined = waitlist.isJoined(KIND);

  return (
    <>
      <button
        type="button"
        className={`${joined ? 'btn-secondary' : 'btn-primary'} mt-5 min-h-11 w-full sm:w-auto`}
        disabled={!waitlist.ready || waitlist.isBusy(KIND)}
        aria-pressed={joined}
        aria-describedby="business-waitlist-consent"
        onClick={() => waitlist.toggle(KIND)}
      >
        {joined ? (
          <>
            <Check className="mr-2 h-4 w-4" aria-hidden="true" />
            You&apos;re on the list
          </>
        ) : (
          'Join the provider waitlist'
        )}
      </button>
      <p id="business-waitlist-consent" className="mt-3 text-xs text-ink-muted">
        {joined ? 'Tap the button again to leave the list. ' : 'You need an account. '}
        We use your account email only to tell you when the directory opens. You can leave the list
        at any time.
      </p>
    </>
  );
}
