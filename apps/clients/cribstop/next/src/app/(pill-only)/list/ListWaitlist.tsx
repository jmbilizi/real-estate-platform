'use client';

import { Check } from 'lucide-react';
import { BRAND } from '@/lib/brand';
import { useWaitlist } from '@/lib/useWaitlist';

const KIND = 'list-property';

export default function ListWaitlist() {
  const waitlist = useWaitlist();
  const joined = waitlist.isJoined(KIND);

  return (
    <section
      aria-labelledby="list-waitlist-heading"
      className="mt-14 rounded-2xl border border-surface-border bg-surface-alt px-4 py-8 text-center sm:px-6"
    >
      <h2 id="list-waitlist-heading" className="font-display text-xl font-bold">
        Be the first to know
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">
        Join the waitlist to hear when listing tools open. You need a {BRAND.siteName} account.
      </p>
      <button
        type="button"
        className={`${joined ? 'btn-secondary' : 'btn-primary'} mt-5 min-h-11 w-full sm:w-auto`}
        disabled={!waitlist.ready || waitlist.isBusy(KIND)}
        aria-pressed={joined}
        aria-describedby="list-waitlist-consent"
        onClick={() => waitlist.toggle(KIND)}
      >
        {joined ? (
          <>
            <Check className="mr-2 h-4 w-4" aria-hidden="true" />
            You&apos;re on the list
          </>
        ) : (
          'Join the list-a-property waitlist'
        )}
      </button>
      {joined && (
        <p className="mt-3 text-sm text-ink-muted">Tap the button again to leave the list.</p>
      )}
      <p id="list-waitlist-consent" className="mx-auto mt-4 max-w-md text-xs text-ink-muted">
        We use your account email only to tell you when listing tools open. You can leave the list
        at any time.
      </p>
    </section>
  );
}
