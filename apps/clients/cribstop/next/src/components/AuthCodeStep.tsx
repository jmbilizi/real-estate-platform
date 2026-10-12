'use client';

import { useEffect, useRef, useState } from 'react';
import {
  CodeNotSentReason,
  CodesUnavailableError,
  CodeTiming,
  RateLimitError,
  resendSignupCode,
  startPasswordReset,
  UndeliverableEmailError,
  verifyResetCode,
  verifySignupCode,
} from '@/lib/api/account';
import { useCountdown } from '@/lib/useCountdown';

const CODE_LENGTH = 6;

export const UNDELIVERABLE_COPY =
  'We cannot deliver email to this address. Check it, or use a different email.';

/** Keeps digits only, so a pasted "123 456" or "123-456" works. */
function digitsOnly(value: string): string {
  return value.replace(/\D/g, '').slice(0, CODE_LENGTH);
}

/** A wait longer than one hour shows "try again later", not a countdown. */
const LONG_WAIT_SECONDS = 3600;

function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * What the step says when the call queued no code (#813). The words are the same for every
 * address, so they do not show whether an account exists.
 */
export function notSentCopy(reason: CodeNotSentReason, waitSeconds: number): string {
  const when =
    waitSeconds <= 0
      ? 'now'
      : waitSeconds > LONG_WAIT_SECONDS
        ? 'later'
        : `in ${clock(waitSeconds)}`;
  switch (reason) {
    case 'pending':
      return 'Check your inbox for the code we sent earlier.';
    case 'notice':
      return 'We sent you an email with the next step. Check your inbox.';
    case 'hourly_cap':
      return `You reached the hourly limit for codes. Check your inbox for the code we sent earlier, or try again ${when}.`;
    case 'daily_cap':
      return `You reached the daily limit for codes. Check your inbox for the code we sent earlier, or try again ${when}.`;
    case 'network_cap':
      return `We got too many code requests from your network. Try again ${when}.`;
    case 'locked':
      return `Too many wrong codes for this email. Try again ${when}.`;
    default:
      return waitSeconds <= 0
        ? 'Check your inbox for the code we sent earlier, or ask for a new one now.'
        : `We sent a code less than a minute ago. Check your inbox, or ask for a new one ${when}.`;
  }
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
  notSentReason,
  onVerified,
  onChangeEmail,
  verify,
  resend: resendOverride,
  label = '6-digit code',
  unavailableMessage,
  focusOnMount = false,
  canResend = true,
}: {
  email: string;
  flow?: 'signup' | 'reset';
  resendAfterSeconds: number;
  expiresInSeconds: number;
  /** Set when the call that opened the step queued no code (#813). */
  notSentReason?: CodeNotSentReason;
  onVerified: (proof: string) => void;
  /** Shows the "Change email" button. Omit it to hide the button. */
  onChangeEmail?: () => void;
  /** Replaces the sign-up or reset check, for a flow that is neither. */
  verify?: (
    code: string,
  ) => Promise<{ ok: true; proof: string } | { ok: false; attemptsLeft: number | null }>;
  /** Replaces the sign-up or reset resend. */
  resend?: () => Promise<CodeTiming>;
  label?: string;
  unavailableMessage?: string;
  focusOnMount?: boolean;
  /** False hides "Send a new code", for a code that cannot be sent again alone. */
  canResend?: boolean;
}) {
  const verifyCode = async (address: string, value: string) => {
    if (verify) return verify(value);
    if (flow === 'reset') {
      const r = await verifyResetCode(address, value);
      return r.ok ? { ok: true as const, proof: r.resetProof } : r;
    }
    const r = await verifySignupCode(address, value);
    return r.ok ? { ok: true as const, proof: r.signupProof } : r;
  };
  const resendCode = (address: string) =>
    resendOverride
      ? resendOverride()
      : (flow === 'reset' ? startPasswordReset : resendSignupCode)(address);
  const unavailableCopy =
    unavailableMessage ??
    (flow === 'reset'
      ? 'Password reset is unavailable right now. Try again soon.'
      : 'Sign-up is unavailable right now. Try again soon.');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const resend = useCountdown(resendAfterSeconds);
  const expiry = useCountdown(expiresInSeconds);
  const lock = useCountdown(0);
  const [expiryArmed, setExpiryArmed] = useState(expiresInSeconds > 0);
  // Cleared when a new code is queued.
  const [notSent, setNotSent] = useState<CodeNotSentReason | undefined>(notSentReason);
  const [notSentWait, setNotSentWait] = useState(resendAfterSeconds);
  const longWait = notSent !== undefined && notSentWait > LONG_WAIT_SECONDS;
  const inputRef = useRef<HTMLInputElement>(null);

  const expired = expiryArmed && expiry.seconds === 0;
  const locked = lock.seconds > 0;

  useEffect(() => {
    if (focusOnMount) inputRef.current?.focus();
  }, [focusOnMount]);

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
      setNotSent(timing.notSentReason);
      setNotSentWait(timing.resendAfterSeconds);
      if (!timing.notSentReason) setNotice('New code sent. The old one no longer works.');
      inputRef.current?.focus();
    } catch (err) {
      if (err instanceof RateLimitError) {
        resend.start(err.retryAfterSeconds);
        setError(
          err.retryAfterSeconds > LONG_WAIT_SECONDS
            ? 'You reached the limit for new codes. Try again later.'
            : `You can ask for another code in ${clock(err.retryAfterSeconds)}.`,
        );
      } else if (err instanceof CodesUnavailableError) {
        setError(unavailableCopy);
      } else if (err instanceof UndeliverableEmailError) {
        setError(UNDELIVERABLE_COPY);
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
          {label}
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
        {!error && !notice && notSent && (
          <p className="text-ink-muted">{notSentCopy(notSent, resend.seconds)}</p>
        )}
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
        {canResend && (
          <button
            type="button"
            onClick={() => void sendNew()}
            disabled={isSending || resend.seconds > 0}
            className="inline-flex min-h-11 items-center font-medium text-brand hover:underline disabled:text-ink-subtle disabled:no-underline"
          >
            {resend.seconds === 0
              ? 'Send a new code'
              : longWait
                ? 'Try again later'
                : `Send a new code in ${resend.seconds}s`}
          </button>
        )}
        {onChangeEmail && (
          <button
            type="button"
            onClick={onChangeEmail}
            className="inline-flex min-h-11 items-center font-medium text-brand hover:underline"
          >
            Change email
          </button>
        )}
      </div>
    </form>
  );
}
