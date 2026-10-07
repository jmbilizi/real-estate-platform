'use client';

import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useApp } from '@/lib/context';
import {
  CodesUnavailableError,
  DEFAULT_PASSWORD_MIN_LENGTH,
  getPasswordMinLength,
  PasswordRejectionCode,
  RateLimitError,
} from '@/lib/api/account';

export type SetPasswordFailure = 'invalid_proof' | 'email_unavailable';

function rejectionCopy(codes: PasswordRejectionCode[], minLength: number): string {
  if (codes.includes('breached')) return 'That password has leaked before. Pick another.';
  if (codes.includes('too_short')) {
    return `That password is too short. Use ${minLength} or more characters.`;
  }
  if (codes.includes('too_long')) return 'That password is too long. Shorten it.';
  return 'That password did not work. Pick another.';
}

/** The last step of sign-up. It creates the account and signs the consumer in. */
export default function AuthSetPasswordStep({
  email,
  signupProof,
  onSignedIn,
  onFailed,
}: {
  email: string;
  signupProof: string;
  onSignedIn: () => void;
  onFailed: (reason: SetPasswordFailure) => void;
}) {
  const { completeSignup } = useApp();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [minLength, setMinLength] = useState(DEFAULT_PASSWORD_MIN_LENGTH);

  useEffect(() => {
    let active = true;
    getPasswordMinLength().then((n) => {
      if (active) setMinLength(n);
    });
    return () => {
      active = false;
    };
  }, []);

  const longEnough = password.length >= minLength;
  const matches = password.length > 0 && password === confirm;
  const mismatch = confirm.length > 0 && !matches;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!longEnough || !matches || isSubmitting) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const outcome = await completeSignup(email, signupProof, password);
      if (outcome.ok) {
        onSignedIn();
        return;
      }
      if (outcome.reason === 'password_rejected') {
        setError(rejectionCopy(outcome.errors, minLength));
        setPassword('');
        setConfirm('');
        passwordRef.current?.focus();
        return;
      }
      onFailed(outcome.reason);
    } catch (err) {
      if (err instanceof RateLimitError) {
        setError(`Too many tries. Try again in ${err.retryAfterSeconds} seconds.`);
      } else if (err instanceof CodesUnavailableError) {
        setError('Sign-up is unavailable right now. Try again soon.');
      } else {
        setError('We could not create your account. Try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const type = show ? 'text' : 'password';

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <label
          htmlFor="auth-new-password"
          className="mb-1 block text-sm font-medium text-ink-muted"
        >
          Set your password
        </label>
        <div className="relative">
          <input
            id="auth-new-password"
            ref={passwordRef}
            type={type}
            required
            autoComplete="new-password"
            className="input-field min-h-11 pr-12"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby="auth-password-rule"
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
        <p
          id="auth-password-rule"
          className={`mt-1 text-xs ${longEnough ? 'text-green-600' : 'text-ink-muted'}`}
        >
          {minLength} or more characters. A phrase works.
        </p>
      </div>

      <div>
        <label
          htmlFor="auth-confirm-password"
          className="mb-1 block text-sm font-medium text-ink-muted"
        >
          Confirm password
        </label>
        <input
          id="auth-confirm-password"
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
        disabled={isSubmitting || !longEnough || !matches}
        aria-busy={isSubmitting}
      >
        {isSubmitting ? 'Please wait...' : 'Create account'}
      </button>
    </form>
  );
}
