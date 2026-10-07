'use client';

import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import {
  AuthError,
  changePassword,
  CodesUnavailableError,
  DEFAULT_PASSWORD_MIN_LENGTH,
  getPasswordMinLength,
  RateLimitError,
} from '@/lib/api/account';
import { useAppDispatch } from '@/lib/store/hooks';
import { renewSession } from '@/lib/store/slices/authSlice';
import { useCountdown } from '@/lib/useCountdown';
import { rejectionCopy } from '@/components/AuthSetPasswordStep';

/** Change password: current, new, confirm. A change ends every other session. */
export default function ChangePasswordFlow({
  email,
  onClose,
}: {
  email: string;
  onClose: () => void;
}) {
  const dispatch = useAppDispatch();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [minLength, setMinLength] = useState(DEFAULT_PASSWORD_MIN_LENGTH);
  const lock = useCountdown(0);
  const currentRef = useRef<HTMLInputElement>(null);
  const newRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let active = true;
    getPasswordMinLength().then((n) => {
      if (active) setMinLength(n);
    });
    currentRef.current?.focus();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (done) headingRef.current?.focus();
  }, [done]);

  const longEnough = next.length >= minLength;
  const matches = next.length > 0 && next === confirm;
  const mismatch = confirm.length > 0 && !matches;
  const locked = lock.seconds > 0;
  const canSubmit = current.length > 0 && longEnough && matches && !busy && !locked;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setBusy(true);
    try {
      const outcome = await changePassword({ currentPassword: current, newPassword: next });
      if (outcome.ok) {
        dispatch(renewSession({ email: outcome.email || email, accessToken: outcome.accessToken }));
        setCurrent('');
        setNext('');
        setConfirm('');
        setDone(true);
        return;
      }
      if (outcome.reason === 'wrong_password') {
        setError('That password did not work.');
        setCurrent('');
        currentRef.current?.focus();
      } else {
        setError(rejectionCopy(outcome.errors, minLength));
        setNext('');
        setConfirm('');
        newRef.current?.focus();
      }
    } catch (err) {
      if (err instanceof RateLimitError) {
        lock.start(err.retryAfterSeconds);
        setError(`Too many tries. Try again in ${err.retryAfterSeconds} seconds.`);
      } else if (err instanceof CodesUnavailableError) {
        setError('Password change is unavailable right now. Try again soon.');
      } else if (err instanceof AuthError) {
        setError('Sign in again to change your password.');
      } else {
        setError('We could not update your password. Try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div role="status" className="flex flex-col gap-4">
        <h3 ref={headingRef} tabIndex={-1} className="text-base font-semibold outline-none">
          Your password is updated
        </h3>
        <p className="text-sm text-ink-muted">Other devices were signed out.</p>
        <button type="button" onClick={onClose} className="btn-primary min-h-11 w-full py-3">
          Done
        </button>
      </div>
    );
  }

  const type = show ? 'text' : 'password';
  const labelClass = 'mb-1 block text-sm font-medium text-ink-muted';

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <input
        type="email"
        autoComplete="username"
        value={email}
        readOnly
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
      />
      <div>
        <label htmlFor="change-password-current" className={labelClass}>
          Current password
        </label>
        <div className="relative">
          <input
            id="change-password-current"
            ref={currentRef}
            type={type}
            required
            autoComplete="current-password"
            className="input-field min-h-11 pr-12"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-ink-subtle hover:text-ink"
            aria-label={show ? 'Hide passwords' : 'Show passwords'}
            aria-pressed={show}
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <div>
        <label htmlFor="change-password-new" className={labelClass}>
          New password
        </label>
        <input
          id="change-password-new"
          ref={newRef}
          type={type}
          required
          autoComplete="new-password"
          className="input-field min-h-11"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          aria-describedby="change-password-rule"
        />
        <p
          id="change-password-rule"
          className={`mt-1 text-xs ${longEnough ? 'text-green-600' : 'text-ink-muted'}`}
        >
          {minLength} or more characters. A phrase works.
        </p>
      </div>

      <div>
        <label htmlFor="change-password-confirm" className={labelClass}>
          Confirm new password
        </label>
        <input
          id="change-password-confirm"
          type={type}
          required
          autoComplete="new-password"
          className="input-field min-h-11"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          aria-invalid={mismatch ? true : undefined}
        />
      </div>

      <div aria-live="polite" className="min-h-5 text-center text-sm">
        {error && (
          <p role="alert" className="text-red-600">
            {error}
          </p>
        )}
        {!error && mismatch && <p className="text-ink-muted">The passwords do not match yet.</p>}
      </div>

      <button
        type="submit"
        className="btn-primary min-h-11 w-full py-3 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={!canSubmit}
        aria-busy={busy}
      >
        {busy ? 'Please wait...' : 'Update password'}
      </button>
      <button
        type="button"
        onClick={onClose}
        className="inline-flex min-h-11 items-center justify-center text-sm font-medium text-ink-muted hover:text-ink"
      >
        Cancel
      </button>
    </form>
  );
}
