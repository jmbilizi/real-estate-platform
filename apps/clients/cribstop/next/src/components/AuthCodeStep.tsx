'use client';

import { useEffect, useRef, useState } from 'react';
import {
  CodesUnavailableError,
  RateLimitError,
  resendSignupCode,
  startPasswordReset,
  verifyResetCode,
  verifySignupCode,
} from '@/lib/api/account';
import { useCountdown } from '@/lib/useCountdown';

const CODE_LENGTH = 6;

/** Keeps digits only, so a pasted "123 456" or "123-456" works. */
function digitsOnly(value: string): string {
  return value.replace(/\D/g, '').slice(0, CODE_LENGTH);
}

function triesLeftCopy(attemptsLeft: number | null): string {
  if (attemptsLeft === null) return 'That code did not work.';
  if (attemptsLeft <= 0) return 'That code did not work. No tries left.';
  return `That code did not work. ${attemptsLeft} ${attemptsLeft === 1 ? 'try' : 'tries'} left.`;
}

/**
 * The code step of sign-up and of password reset. A correct code hands the one-time proof to the
 * parent, which keeps it in memory only.
 */
export default function AuthCodeStep({
  email,
  flow = 'signup',
  resendAfterSeconds,
  expiresInSeconds,
  onVerified,
  onChangeEmail,
}: {
  email: string;
  flow?: 'signup' | 'reset';
  resendAfterSeconds: number;
  expiresInSeconds: number;
  onVerified: (proof: string) => void;
  onChangeEmail: () => void;
}) {
  const verifyCode = async (address: string, value: string) => {
    if (flow === 'reset') {
      const r = await verifyResetCode(address, value);
      return r.ok ? { ok: true as const, proof: r.resetProof } : r;
    }
    const r = await verifySignupCode(address, value);
    return r.ok ? { ok: true as const, proof: r.signupProof } : r;
  };
  const resendCode = flow === 'reset' ? startPasswordReset : resendSignupCode;
  const unavailableCopy =
    flow === 'reset'
      ? 'Password reset is unavailable right now. Try again soon.'
      : 'Sign-up is unavailable right now. Try again soon.';
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const resend = useCountdown(resendAfterSeconds);
  const expiry = useCountdown(expiresInSeconds);
  const lock = useCountdown(0);
  const [expiryArmed, setExpiryArmed] = useState(expiresInSeconds > 0);
  const inputRef = useRef<HTMLInputElement>(null);

  const expired = expiryArmed && expiry.seconds === 0;
  const locked = lock.seconds > 0;

  useEffect(() => {
    if (expired) setError('That code expired. Send a new one.');
  }, [expired]);

  const submit = async (value: string) => {
    if (value.length !== CODE_LENGTH || isChecking || expired || locked) return;
    setError(null);
    setNotice(null);
    setIsChecking(true);
    try {
      const result = await verifyCode(email, value);
      if (result.ok) {
        onVerified(result.proof);
        return;
      }
      setError(triesLeftCopy(result.attemptsLeft));
      setCode('');
      inputRef.current?.focus();
    } catch (err) {
      if (err instanceof RateLimitError) {
        lock.start(err.retryAfterSeconds);
        setError(`Too many tries. Try again in ${err.retryAfterSeconds} seconds.`);
      } else if (err instanceof CodesUnavailableError) {
        setError(unavailableCopy);
      } else {
        setError('We could not check that code. Try again.');
      }
      setCode('');
    } finally {
      setIsChecking(false);
    }
  };

  const update = (raw: string) => {
    const next = digitsOnly(raw);
    setCode(next);
    if (next.length === CODE_LENGTH) void submit(next);
  };

  const sendNew = async () => {
    setError(null);
    setNotice(null);
    setIsSending(true);
    try {
      const timing = await resendCode(email);
      resend.start(timing.resendAfterSeconds);
      expiry.start(timing.expiresInSeconds);
      setExpiryArmed(timing.expiresInSeconds > 0);
      lock.start(0);
      setCode('');
      setNotice('New code sent. The old one no longer works.');
      inputRef.current?.focus();
    } catch (err) {
      if (err instanceof RateLimitError) {
        resend.start(err.retryAfterSeconds);
        setError(`You can ask for another code in ${err.retryAfterSeconds} seconds.`);
      } else if (err instanceof CodesUnavailableError) {
        setError(unavailableCopy);
      } else {
        setError('We could not send a new code. Try again.');
      }
    } finally {
      setIsSending(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit(code);
      }}
      className="flex flex-col gap-4"
    >
      <div>
        <label htmlFor="auth-code" className="mb-1 block text-sm font-medium text-ink-muted">
          6-digit code
        </label>
        <input
          id="auth-code"
          ref={inputRef}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="one-time-code"
          maxLength={CODE_LENGTH}
          className="input-field min-h-11 text-center font-mono text-xl tracking-[0.4em]"
          placeholder="000000"
          value={code}
          readOnly={isChecking}
          disabled={locked}
          aria-describedby="auth-code-status"
          aria-invalid={error ? true : undefined}
          onChange={(e) => update(e.target.value)}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData('text');
            if (!pasted) return;
            e.preventDefault();
            update(pasted);
          }}
        />
      </div>

      <div id="auth-code-status" aria-live="polite" className="min-h-5 text-center text-sm">
        {error && (
          <p role="alert" className="text-red-600">
            {error}
          </p>
        )}
        {!error && notice && <p className="text-ink-muted">{notice}</p>}
      </div>

      <button
        type="submit"
        className="btn-primary min-h-11 w-full py-3 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={isChecking || locked || expired || code.length !== CODE_LENGTH}
        aria-busy={isChecking}
      >
        {isChecking ? 'Checking...' : 'Continue'}
      </button>

      <div className="flex flex-col items-center gap-1 text-sm">
        <button
          type="button"
          onClick={() => void sendNew()}
          disabled={isSending || resend.seconds > 0}
          className="inline-flex min-h-11 items-center font-medium text-brand hover:underline disabled:text-ink-subtle disabled:no-underline"
        >
          {resend.seconds > 0 ? `Send a new code in ${resend.seconds}s` : 'Send a new code'}
        </button>
        <button
          type="button"
          onClick={onChangeEmail}
          className="inline-flex min-h-11 items-center font-medium text-brand hover:underline"
        >
          Change email
        </button>
      </div>
    </form>
  );
}
