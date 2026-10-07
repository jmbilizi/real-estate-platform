'use client';

import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import {
  AuthError,
  CodesUnavailableError,
  CodeTiming,
  RateLimitError,
  startEmailChange,
  verifyEmailChange,
} from '@/lib/api/account';
import { useAppDispatch } from '@/lib/store/hooks';
import { renewSession } from '@/lib/store/slices/authSlice';
import AuthCodeStep from '@/components/AuthCodeStep';

type Step = 'stepUp' | 'newEmail' | 'oldCode' | 'newCode' | 'done';
type Method = 'password' | 'code';

const NO_TIMING: CodeTiming = { resendAfterSeconds: 0, expiresInSeconds: 0 };

function failureCopy(err: unknown): string {
  if (err instanceof RateLimitError) {
    return `Too many tries. Try again in ${err.retryAfterSeconds} seconds.`;
  }
  if (err instanceof CodesUnavailableError) {
    return 'Email change is unavailable right now. Try again soon.';
  }
  if (err instanceof AuthError) return 'Sign in again to change your email.';
  return 'We could not do that. Try again.';
}

/**
 * Change email: confirm with the password or a code at the current address, enter the new
 * address, enter the code sent there. Copy never says whether an address is in use.
 */
export default function ChangeEmailFlow({ onClose }: { onClose: () => void }) {
  const dispatch = useAppDispatch();
  const [step, setStep] = useState<Step>('stepUp');
  const [method, setMethod] = useState<Method>('password');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [timing, setTiming] = useState<CodeTiming>(NO_TIMING);
  const [doneEmail, setDoneEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The code step reports its timing here, because the code step owns the call.
  const pendingTiming = useRef<CodeTiming>(NO_TIMING);

  // Each step moves focus: the first field, or the heading when nothing is left to type.
  useEffect(() => {
    if (step === 'done') headingRef.current?.focus();
    else if (step === 'stepUp' || step === 'newEmail') {
      containerRef.current?.querySelector('input')?.focus();
    }
  }, [step]);

  const go = (next: Step) => {
    setError(null);
    setStep(next);
  };

  const submitStepUp = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setMethod('password');
    go('newEmail');
  };

  const useCodeInstead = () => {
    setMethod('code');
    setPassword('');
    go('newEmail');
  };

  const submitNewEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    const address = newEmail.trim();
    if (!address || busy) return;
    setError(null);
    setBusy(true);
    try {
      const result = await startEmailChange(
        method === 'password'
          ? { newEmail: address, currentPassword: password }
          : { newEmail: address },
      );
      if (!result.ok) {
        if (result.reason === 'invalid_email') {
          setError('Enter a valid email address.');
        } else {
          setPassword('');
          setError(
            result.attemptsLeft === null
              ? 'That password did not work.'
              : `That password did not work. ${result.attemptsLeft} ${result.attemptsLeft === 1 ? 'try' : 'tries'} left.`,
          );
          setStep('stepUp');
        }
        return;
      }
      setTiming(result);
      go(result.stepUp === 'oldEmailCode' ? 'oldCode' : 'newCode');
    } catch (err) {
      setError(failureCopy(err));
    } finally {
      setBusy(false);
    }
  };

  const confirmWithOldCode = async (code: string) => {
    const result = await startEmailChange({ newEmail: newEmail.trim(), oldEmailCode: code });
    if (result.ok) {
      pendingTiming.current = result;
      return { ok: true as const, proof: '' };
    }
    return {
      ok: false as const,
      attemptsLeft: result.reason === 'step_up_failed' ? result.attemptsLeft : null,
    };
  };

  const confirmNewCode = async (code: string) => {
    const result = await verifyEmailChange(code, newEmail.trim());
    if (!result.ok) return result;
    dispatch(renewSession({ email: result.email, accessToken: result.accessToken }));
    setDoneEmail(result.email);
    setPassword('');
    return { ok: true as const, proof: '' };
  };

  const passwordType = showPassword ? 'text' : 'password';
  const errorRegion = (
    <div aria-live="polite" className="empty:hidden text-center text-sm">
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
    </div>
  );
  const backButton = (to: Step) => (
    <button
      type="button"
      onClick={() => go(to)}
      className="inline-flex min-h-11 items-center justify-center text-sm font-medium text-brand hover:underline"
    >
      Back
    </button>
  );

  return (
    <div ref={containerRef} className="flex flex-col gap-4">
      {step === 'stepUp' && (
        <form onSubmit={submitStepUp} className="flex flex-col gap-4">
          <h3 className="text-base font-semibold">Confirm it is you</h3>
          <div>
            <label
              htmlFor="change-email-password"
              className="mb-1 block text-sm font-medium text-ink-muted"
            >
              Current password
            </label>
            <div className="relative">
              <input
                id="change-email-password"
                type={passwordType}
                required
                autoComplete="current-password"
                className="input-field min-h-11 pr-12"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-ink-subtle hover:text-ink"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          {errorRegion}
          <button type="submit" className="btn-primary min-h-11 w-full py-3" disabled={!password}>
            Continue
          </button>
          <button
            type="button"
            onClick={useCodeInstead}
            className="inline-flex min-h-11 items-center justify-center text-sm font-medium text-brand hover:underline"
          >
            Email a code to my current address instead
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 items-center justify-center text-sm font-medium text-ink-muted hover:text-ink"
          >
            Cancel
          </button>
        </form>
      )}

      {step === 'newEmail' && (
        <form onSubmit={submitNewEmail} className="flex flex-col gap-4">
          <h3 className="text-base font-semibold">Enter your new email</h3>
          <div>
            <label
              htmlFor="change-email-new"
              className="mb-1 block text-sm font-medium text-ink-muted"
            >
              New email address
            </label>
            <input
              id="change-email-new"
              type="email"
              required
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              className="input-field min-h-11"
              placeholder="you@example.com"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
          </div>
          {errorRegion}
          <button
            type="submit"
            className="btn-primary min-h-11 w-full py-3 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy || !newEmail.trim()}
            aria-busy={busy}
          >
            {busy ? 'Please wait...' : 'Continue'}
          </button>
          {backButton('stepUp')}
        </form>
      )}

      {step === 'oldCode' && (
        <div className="flex flex-col gap-4">
          <h3 className="text-base font-semibold">Check your current email</h3>
          <p className="text-sm text-ink-muted">
            We sent a code to your current email address. Enter it to continue.
          </p>
          <AuthCodeStep
            email={newEmail}
            label="Code from your current email"
            focusOnMount
            resendAfterSeconds={timing.resendAfterSeconds}
            expiresInSeconds={timing.expiresInSeconds}
            unavailableMessage="Email change is unavailable right now. Try again soon."
            verify={confirmWithOldCode}
            resend={async () => {
              const r = await startEmailChange({ newEmail: newEmail.trim() });
              if (!r.ok) throw new Error('Unable to send a new code');
              return r;
            }}
            onVerified={() => {
              setTiming(pendingTiming.current);
              go('newCode');
            }}
          />
          {backButton('newEmail')}
        </div>
      )}

      {step === 'newCode' && (
        <div className="flex flex-col gap-4">
          <h3 className="text-base font-semibold">Check your new email</h3>
          <p className="text-sm text-ink-muted">
            If that address can be used, we sent a code to {newEmail.trim()}. Enter it here.
          </p>
          <AuthCodeStep
            email={newEmail}
            label="Code from your new email"
            focusOnMount
            canResend={method === 'password'}
            resendAfterSeconds={timing.resendAfterSeconds}
            expiresInSeconds={timing.expiresInSeconds}
            unavailableMessage="Email change is unavailable right now. Try again soon."
            verify={confirmNewCode}
            resend={async () => {
              const r = await startEmailChange({
                newEmail: newEmail.trim(),
                currentPassword: password,
              });
              if (!r.ok) throw new Error('Unable to send a new code');
              return r;
            }}
            onVerified={() => go('done')}
          />
          {backButton('newEmail')}
        </div>
      )}

      {step === 'done' && (
        <div role="status" className="flex flex-col gap-4">
          <h3 ref={headingRef} tabIndex={-1} className="text-base font-semibold outline-none">
            Your email is updated
          </h3>
          <p className="text-sm text-ink-muted">
            Your email is now {doneEmail}. We emailed your old address about this change. Other
            devices were signed out.
          </p>
          <button type="button" onClick={onClose} className="btn-primary min-h-11 w-full py-3">
            Done
          </button>
        </div>
      )}
    </div>
  );
}
