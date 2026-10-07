'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { secureAccount } from '@/lib/api/account';

type Status = 'confirm' | 'working' | 'secured' | 'invalid' | 'failed';

/**
 * Takes the token from the notice link, removes it from the address bar, and waits for the user to
 * press the button. Only that press sends the token, with a POST. Loading the page never acts.
 *
 * An unknown, used and expired token show the same panel, so the page does not say which it was.
 */
export default function SecureAccountForm({ token }: { token: string | null }) {
  const [status, setStatus] = useState<Status>(token ? 'confirm' : 'invalid');
  const [emailRestored, setEmailRestored] = useState(false);
  const router = useRouter();

  // Strips the token from the visible URL and this history entry. A plain history rewrite keeps
  // Next.js from re-rendering the page and dropping the prop this component mounted with.
  const stripped = useRef(false);
  useEffect(() => {
    if (stripped.current) return;
    stripped.current = true;
    if (token && typeof window !== 'undefined') {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [token]);

  // Each status renders a different heading in the same place, so focus moves to it every time.
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, [status]);

  const handleSecure = async () => {
    if (!token || status === 'working') return;
    setStatus('working');
    const outcome = await secureAccount(token);
    if (outcome.status === 'secured') {
      setEmailRestored(outcome.emailRestored);
      setStatus('secured');
    } else {
      // A failed call may still leave the token unused, so the user may try again.
      setStatus(outcome.status === 'invalid' ? 'invalid' : 'failed');
    }
  };

  const heading = (text: string) => (
    <h1
      ref={headingRef}
      tabIndex={-1}
      className="text-center font-display text-2xl font-bold tracking-tight outline-none"
    >
      {text}
    </h1>
  );

  if (status === 'invalid') {
    return (
      <Card>
        {heading('This link no longer works')}
        <p className="mt-2 text-center text-sm text-ink-muted">
          The link may have expired or may already be used. If you still think someone else has
          access to your account, reset your password.
        </p>
        <ResetButton onClick={() => router.push('/?modal=login&mode=forgot')} />
      </Card>
    );
  }

  if (status === 'secured') {
    return (
      <Card>
        {heading('Your account is secure')}
        <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-ink-muted">
          <li>We signed out every device.</li>
          <li>We removed your password.</li>
          {emailRestored && <li>We put your previous email address back.</li>}
        </ul>
        <p className="mt-4 text-sm text-ink-muted">
          Choose a new password to sign in again. We send a code to your email address.
        </p>
        <ResetButton onClick={() => router.push('/?modal=login&mode=forgot')} />
      </Card>
    );
  }

  return (
    <Card>
      {heading('Secure your account')}
      <p className="mt-2 text-center text-sm text-ink-muted">
        If you did not make this change, press the button. We sign out every device, remove your
        password, and undo a recent email change if we can.
      </p>
      {status === 'failed' && (
        <p role="alert" className="mt-4 text-center text-sm text-red-600">
          Something went wrong. Try again.
        </p>
      )}
      <button
        type="button"
        onClick={handleSecure}
        disabled={status === 'working'}
        className="btn-primary mt-6 w-full py-3 disabled:opacity-60"
      >
        {status === 'working' ? 'Securing…' : 'This wasn’t me, secure my account'}
      </button>
    </Card>
  );
}

function ResetButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="btn-primary mt-6 w-full py-3">
      Reset your password
    </button>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-md">
      <div className="rounded-3xl border border-surface-border bg-white p-6 shadow-card sm:p-10">
        {children}
      </div>
    </div>
  );
}
