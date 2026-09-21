'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
import { useApp } from '@/lib/context';
import { useToast } from '@/lib/useToast';
import PasswordRequirements from '@/components/PasswordRequirements';
import { passwordMeetsRules } from '@/lib/password-rules';
import { confirmPasswordReset, PasswordResetError, RateLimitError } from '@/lib/api/account';

type Status = 'form' | 'invalid' | 'success';

/**
 * Reads `email`/`code` from the link the reset email sends, redeems them against
 * `/account/resetPassword`, and clears them from the address bar once used.
 *
 * A missing or a rejected code render the same `invalid` panel: an unusable token, an unknown
 * address and an unconfirmed address must not be told apart (#137).
 */
export default function ResetPasswordForm({
  email,
  code,
}: {
  email: string | null;
  code: string | null;
}) {
  const [status, setStatus] = useState<Status>(email && code ? 'form' : 'invalid');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const { login } = useApp();
  const { toast } = useToast();
  const router = useRouter();

  // Strips email/code from the visible URL and from this history entry, without asking Next.js to
  // re-render the page for the new URL (that would drop the props this component was mounted
  // with). A plain history rewrite, not a router navigation, is what's needed here.
  const stripped = useRef(false);
  useEffect(() => {
    if (stripped.current) return;
    stripped.current = true;
    if ((email || code) && typeof window !== 'undefined') {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [email, code]);

  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  if (status === 'invalid') {
    return (
      <Card>
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-center font-display text-2xl font-bold tracking-tight"
        >
          This link no longer works
        </h2>
        <p className="mt-2 text-center text-sm text-ink-muted">
          The link may have expired, already been used, or the address on it isn&apos;t confirmed.
          Request a new one to continue.
        </p>
        <a href="/forgot-password" className="btn-primary mt-6 w-full py-3 text-center">
          Request a new link
        </a>
      </Card>
    );
  }

  if (status === 'success') {
    return (
      <Card>
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-center font-display text-2xl font-bold tracking-tight"
        >
          Password reset
        </h2>
        <p className="mt-2 text-center text-sm text-ink-muted">
          As a security precaution, we&apos;ve signed out your other browser sessions.
        </p>
      </Card>
    );
  }

  const rulesMet = passwordMeetsRules(newPassword);
  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!rulesMet) {
      setFormError('Password does not meet the requirements below.');
      return;
    }
    if (!passwordsMatch) {
      // The confirm-password field already shows this inline; no need to repeat it here.
      return;
    }

    setIsSubmitting(true);
    try {
      await confirmPasswordReset({ email: email as string, code: code as string, newPassword });
      setStatus('success');

      try {
        await login(email as string, newPassword);
        toast('Password reset. Welcome back!');
        router.push('/');
      } catch {
        // The reset succeeded even if auto-login did not — send them to sign in manually.
        toast('Password reset. Please sign in with your new password.', 'info');
        router.push('/?modal=login');
      }
    } catch (err) {
      if (err instanceof RateLimitError) {
        toast(`Too many attempts. Try again in ${err.retryAfterSeconds} seconds.`, 'error');
      } else if (err instanceof PasswordResetError && err.kind === 'invalid') {
        setStatus('invalid');
      } else if (err instanceof PasswordResetError && err.kind === 'policy') {
        setFormError('Password does not meet the requirements below.');
      } else {
        toast('Something went wrong. Try again.', 'error');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card>
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="text-center font-display text-2xl font-bold tracking-tight"
      >
        Choose a new password
      </h2>
      <p className="mt-2 text-center text-sm text-ink-muted">Enter and confirm your new password</p>

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
        <div>
          <label
            htmlFor="reset-new-password"
            className="mb-1 block text-sm font-medium text-ink-muted"
          >
            New password
          </label>
          <div className="relative">
            <input
              id="reset-new-password"
              type={showPassword ? 'text' : 'password'}
              required
              className="input-field pr-10"
              placeholder="••••••••"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              aria-describedby="reset-password-requirements"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute inset-y-0 right-0 flex items-center px-3 text-ink-subtle hover:text-ink"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              tabIndex={-1}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <div id="reset-password-requirements">
            <PasswordRequirements password={newPassword} />
          </div>
        </div>

        <div>
          <label
            htmlFor="reset-confirm-password"
            className="mb-1 block text-sm font-medium text-ink-muted"
          >
            Confirm new password
          </label>
          <input
            id="reset-confirm-password"
            type={showPassword ? 'text' : 'password'}
            required
            className="input-field"
            placeholder="••••••••"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            aria-invalid={confirmPassword.length > 0 && !passwordsMatch}
            aria-describedby={
              confirmPassword.length > 0 && !passwordsMatch ? 'reset-confirm-mismatch' : undefined
            }
          />
          {confirmPassword.length > 0 && !passwordsMatch && (
            <p id="reset-confirm-mismatch" className="mt-1 text-xs text-red-600" role="alert">
              Passwords do not match.
            </p>
          )}
        </div>

        {formError && (
          <p className="text-center text-sm text-red-600" role="alert">
            {formError}
          </p>
        )}

        <button
          type="submit"
          className="btn-primary mt-2 w-full py-3"
          disabled={isSubmitting}
          aria-busy={isSubmitting}
        >
          {isSubmitting ? 'Please wait...' : 'Reset password'}
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
