'use client';

import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import type { AuthErrorCode } from '@cribstop/property-contracts';
import { useApp } from '@/lib/context';
import {
  CodesUnavailableError,
  completePasswordReset,
  getPasswordPolicy,
  PasswordRejectionCode,
  RateLimitError,
} from '@/lib/api/account';
import { checkPassword, DEFAULT_PASSWORD_POLICY, type PasswordPolicy } from '@/lib/password-rules';
import PasswordRequirements from '@/components/PasswordRequirements';

export type SetPasswordFailure = 'invalid_proof' | 'email_unavailable';

export function rejectionCopy(codes: PasswordRejectionCode[], policy: PasswordPolicy): string {
  if (codes.includes('breached')) return 'That password has leaked before. Pick another.';
  if (codes.includes('too_short')) {
    return `That password is too short. Use ${policy.minLength}+ characters with every rule, or ${policy.passphraseLength}+ characters.`;
  }
  if (codes.some((c) => c.startsWith('missing_'))) {
    return `That password needs every rule. Add what is missing, or use ${policy.passphraseLength}+ characters.`;
  }
  if (codes.includes('too_long')) return 'That password is too long. Shorten it.';
  return 'That password did not work. Pick another.';
}

/**
 * The last step of sign-up and of password reset. Sign-up creates the account and signs the
 * consumer in. Reset sets the password and signs nobody in.
 */
export default function AuthSetPasswordStep({
  email,
  flow = 'signup',
  proof,
  onDone,
  onFailed,
  onFunnelFail,
}: {
  email: string;
  flow?: 'signup' | 'reset';
  proof: string;
  onDone: () => void;
  onFailed: (reason: SetPasswordFailure) => void;
  /** Funnel hook (#827): the step failed in place, with a fixed code. */
  onFunnelFail?: (code: AuthErrorCode) => void;
}) {
  const reset = flow === 'reset';
  const unavailableCopy = reset
    ? 'Password reset is unavailable right now. Try again soon.'
    : 'Sign-up is unavailable right now. Try again soon.';
  const { completeSignup } = useApp();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [policy, setPolicy] = useState<PasswordPolicy>(DEFAULT_PASSWORD_POLICY);

  useEffect(() => {
    let active = true;
    getPasswordPolicy().then((p) => {
      if (active) setPolicy(p);
    });
    return () => {
      active = false;
    };
  }, []);

  const longEnough = checkPassword(password, policy).valid;
  const matches = password.length > 0 && password === confirm;
  const mismatch = confirm.length > 0 && !matches;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!longEnough || !matches || isSubmitting) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const outcome = reset
        ? await completePasswordReset({ email, resetProof: proof, newPassword: password })
        : await completeSignup(email, proof, password);
      if (outcome.ok) {
        onDone();
        return;
      }
      if (outcome.reason === 'password_rejected') {
        onFunnelFail?.('password_rejected');
        setError(rejectionCopy(outcome.errors, policy));
        setPassword('');
        setConfirm('');
        passwordRef.current?.focus();
        return;
      }
      onFailed(outcome.reason);
    } catch (err) {
      onFunnelFail?.(
        err instanceof RateLimitError
          ? 'rate_limited'
          : err instanceof CodesUnavailableError
            ? 'unavailable'
            : 'network',
      );
      if (err instanceof RateLimitError) {
        setError(`Too many tries. Try again in ${err.retryAfterSeconds} seconds.`);
      } else if (err instanceof CodesUnavailableError) {
        setError(unavailableCopy);
      } else {
        setError(
          reset
            ? 'We could not update your password. Try again.'
            : 'We could not create your account. Try again.',
        );
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
          {reset ? 'New password' : 'Set your password'}
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
            aria-describedby="auth-password-rules"
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
        <PasswordRequirements id="auth-password-rules" password={password} policy={policy} />
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
        {isSubmitting ? 'Please wait...' : reset ? 'Update password' : 'Create account'}
      </button>
    </form>
  );
}
