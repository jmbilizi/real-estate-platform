'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { confirmEmail } from '@/lib/api/account';
import { useConfirmationResend } from '@/lib/useConfirmationResend';

type Status = 'confirming' | 'confirmed' | 'invalid';

/**
 * Redeems the `userId`/`code` a confirmation email links to. Expired, used, tampered and unknown
 * links all render the same `invalid` panel (#147's non-enumeration guarantee) — never a reason.
 * An already-confirmed link renders `confirmed`, same as a first-time success.
 */
export default function ConfirmEmailPanel({
  userId,
  code,
}: {
  userId: string | null;
  code: string | null;
}) {
  const [status, setStatus] = useState<Status>('confirming');
  const router = useRouter();
  const resend = useConfirmationResend();
  const [resendEmail, setResendEmail] = useState('');

  // Consumes the link exactly once, then strips userId/code from the visible URL and from this
  // history entry so a shared device or a referrer-exposed navigation cannot replay it (#148). A
  // plain history rewrite, not a router navigation, so Next.js does not re-render for the new URL
  // and drop the props this component was mounted with.
  const consumed = useRef(false);
  useEffect(() => {
    if (consumed.current) return;
    consumed.current = true;

    if (typeof window !== 'undefined' && (userId || code)) {
      window.history.replaceState(null, '', window.location.pathname);
    }

    if (!userId || !code) {
      setStatus('invalid');
      return;
    }

    confirmEmail({ userId, code }).then(setStatus);
  }, [userId, code]);

  // Each status renders a different heading in the same position; a screen reader needs focus
  // moved to it every time.
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, [status]);

  if (status === 'confirming') {
    return (
      <Card>
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-center font-display text-2xl font-bold tracking-tight"
        >
          Confirming your email...
        </h2>
      </Card>
    );
  }

  if (status === 'confirmed') {
    return (
      <Card>
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-center font-display text-2xl font-bold tracking-tight"
        >
          Email confirmed
        </h2>
        <p className="mt-2 text-center text-sm text-ink-muted">
          Your address is confirmed. Sign in to continue.
        </p>
        <button
          type="button"
          onClick={() => router.push('/?modal=login')}
          className="btn-primary mt-6 w-full py-3"
        >
          Continue to sign in
        </button>
      </Card>
    );
  }

  return (
    <Card>
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="text-center font-display text-2xl font-bold tracking-tight"
      >
        This link is no longer valid
      </h2>
      <p className="mt-2 text-center text-sm text-ink-muted">
        The link may have expired, already been used, or the address on it isn&apos;t right. Request
        a new one below.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          resend.resend(resendEmail);
        }}
        className="mt-6 flex flex-col gap-3"
      >
        <label htmlFor="confirm-resend-email" className="sr-only">
          Email address
        </label>
        <input
          id="confirm-resend-email"
          type="email"
          required
          className="input-field"
          placeholder="you@example.com"
          value={resendEmail}
          onChange={(e) => setResendEmail(e.target.value)}
        />
        <p aria-live="polite" className="sr-only">
          {resend.cooldownAnnouncement}
        </p>
        <button
          type="submit"
          disabled={resend.isSending || resend.cooldownSeconds > 0}
          className="btn-primary w-full py-3"
        >
          {resend.cooldownSeconds > 0
            ? `Request a new link (${resend.cooldownSeconds}s)`
            : 'Request a new link'}
        </button>
      </form>
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-md">
      <div className="rounded-3xl border border-surface-border bg-white p-8 shadow-card sm:p-10">
        {children}
      </div>
    </div>
  );
}
