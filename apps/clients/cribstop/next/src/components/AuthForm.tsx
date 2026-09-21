'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
import { useApp } from '@/lib/context';
import { useToast } from '@/lib/useToast';
import {
  getConfirmationExpiryHours,
  RateLimitError,
  requestPasswordReset,
  SignInFailedError,
} from '@/lib/api/account';
import { useConfirmationResend } from '@/lib/useConfirmationResend';
import PasswordRequirements from '@/components/PasswordRequirements';
import { passwordMeetsRules } from '@/lib/password-rules';
import privacyContent from '@/content/legal/privacy.json';
import termsContent from '@/content/legal/terms.json';

// Neither page has approved copy yet, so signup must not claim a binding agreement to a page
// that says, on its own face, "carries no approved legal copy" (#156, #157).
const legalCopyApproved = !privacyContent.isDraft && !termsContent.isDraft;

/** Keyed by hostname so it never collides across environments or domains. */
function getRememberEmailKey() {
  return `cribstop_remember_email_${typeof window !== 'undefined' ? window.location.hostname : 'default'}`;
}

type Mode = 'login' | 'signup' | 'forgot';

export default function AuthForm({
  initialMode = 'login',
  onSuccess,
  onSwitchMode,
  variant = 'page',
}: {
  initialMode?: Mode;
  onSuccess?: () => void;
  onSwitchMode?: (mode: 'login' | 'signup') => void;
  /** 'page': always shows the card border/shadow. 'modal': plain on mobile, card on sm+ */
  variant?: 'page' | 'modal';
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);

  // Pre-fill email and remember checkbox from a previous "Remember me" login.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(getRememberEmailKey());
      if (saved) {
        setEmail(saved);
        setRemember(true);
      }
    } catch {
      // localStorage unavailable (SSR safety, private browsing)
    }
  }, []);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Set once the forgot-password request has gone through. The confirmation shown for it must
  // stay neutral: the server never says whether the address has an account (#147).
  const [resetRequested, setResetRequested] = useState(false);
  // Set once registration has gone through. The waiting state shown for it is identical for a
  // brand-new, an unconfirmed, and an already-confirmed address (#147/#148) — the server answers
  // all three the same way, and the client must not undo that.
  const [signupRequested, setSignupRequested] = useState(false);
  const [signupEmail, setSignupEmail] = useState('');
  const [expiryHours, setExpiryHours] = useState<number | null>(null);
  // Set on a 401 from /account/login. Identity gives the same status for a wrong password and an
  // unconfirmed account (#147), so this offers both remedies without asserting either cause.
  const [loginFailed, setLoginFailed] = useState(false);
  const { login, signup } = useApp();
  const { toast } = useToast();
  const router = useRouter();
  const signupResend = useConfirmationResend();
  const loginResend = useConfirmationResend();

  useEffect(() => {
    if (!signupRequested) return;
    getConfirmationExpiryHours().then(setExpiryHours);
  }, [signupRequested]);

  // Each mode/sub-state renders a different heading in the same position; a screen reader needs
  // focus moved to it every time, not just on first mount.
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, [mode, resetRequested, signupRequested]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setIsSubmitting(true);

    try {
      if (mode === 'login') {
        setLoginFailed(false);
        try {
          await login(email, password, remember);
        } catch (err) {
          if (err instanceof SignInFailedError) {
            setLoginFailed(true);
            return;
          }
          throw err;
        }
        try {
          if (remember) {
            localStorage.setItem(getRememberEmailKey(), email);
          } else {
            localStorage.removeItem(getRememberEmailKey());
          }
        } catch {
          // ignore
        }
        toast('Welcome back!');
        if (onSuccess) onSuccess();
        else router.push('/');
      } else if (mode === 'signup') {
        if (!passwordMeetsRules(password)) {
          setFormError('Password does not meet the requirements below.');
          return;
        }
        await signup(email, password);
        setSignupEmail(email);
        setSignupRequested(true);
      } else {
        try {
          await requestPasswordReset(email);
          setResetRequested(true);
        } catch (err) {
          if (err instanceof RateLimitError) {
            toast(`Too many requests. Try again in ${err.retryAfterSeconds} seconds.`, 'error');
          } else {
            toast('We could not send the request. Try again.', 'error');
          }
        }
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Authentication request failed', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setLoginFailed(false);
    setResetRequested(false);
    if (next !== 'signup') setSignupRequested(false);
    if (next === 'login' || next === 'signup') onSwitchMode?.(next);
  };

  const submitLabels: Record<Mode, string> = {
    login: 'Sign In',
    signup: 'Create Account',
    forgot: 'Send Reset Link',
  };
  let submitLabel = submitLabels[mode];
  if (isSubmitting) submitLabel = 'Please wait...';

  return (
    <div className="mx-auto w-full max-w-md">
      <div
        className={
          variant === 'modal'
            ? 'w-full p-6 sm:rounded-3xl sm:border sm:border-surface-border sm:bg-white sm:p-10 sm:shadow-card'
            : 'rounded-3xl border border-surface-border bg-white p-8 shadow-card sm:p-10'
        }
      >
        {/* TODO(dark-mode): bg-white, border-surface-border and text colours below are
            hardcoded for light mode — make them conditional (dark:bg-surface-alt etc.)
            when dark mode support is added. */}
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-center font-display text-2xl font-bold tracking-tight"
        >
          {mode === 'login' && 'Welcome back'}
          {mode === 'signup' && signupRequested && 'Confirm your email'}
          {mode === 'signup' && !signupRequested && 'Create your account'}
          {mode === 'forgot' && 'Reset your password'}
        </h2>
        <p className="mt-2 text-center text-sm text-ink-muted">
          {mode === 'login' && 'Sign in to save homes and set alerts'}
          {mode === 'signup' &&
            !signupRequested &&
            'Join us to find your dream home'}
          {mode === 'signup' && signupRequested && (
            <>
              A confirmation link is on its way to{' '}
              <span className="font-medium text-ink">{signupEmail}</span>.{' '}
              {expiryHours !== null && <>It expires in {expiryHours} hours. </>}
              Check your inbox and spam folder. Still nothing? Resend it below, or write to{' '}
              <a href="mailto:contact@cribstop.com" className="font-medium text-brand hover:underline">
                contact@cribstop.com
              </a>
              .
            </>
          )}
          {mode === 'forgot' &&
            (resetRequested
              ? 'Check your email for a link to reset your password'
              : "Enter your email and we'll send a reset link")}
        </p>

        {mode !== 'forgot' && !signupRequested && (
          <div className="mt-6 flex flex-col gap-3">
            <button className="btn-secondary gap-2">
              <svg className="h-5 w-5" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              Continue with Google
            </button>
            <button className="btn-secondary gap-2">
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
              </svg>
              Continue with Apple
            </button>
          </div>
        )}

        {mode !== 'forgot' && !signupRequested && (
          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-surface-border" />
            <span className="text-xs text-ink-subtle">or</span>
            <div className="h-px flex-1 bg-surface-border" />
          </div>
        )}

        {mode === 'signup' && signupRequested ? (
          <div className="mt-2 flex flex-col gap-4">
            <p aria-live="polite" className="sr-only">
              {signupResend.cooldownAnnouncement}
            </p>
            <button
              type="button"
              onClick={() => signupResend.resend(signupEmail)}
              disabled={signupResend.isSending || signupResend.cooldownSeconds > 0}
              className="btn-secondary w-full py-3"
            >
              {signupResend.cooldownSeconds > 0
                ? `Resend link (${signupResend.cooldownSeconds}s)`
                : 'Resend confirmation link'}
            </button>
            <div className="flex flex-col items-center gap-2 text-sm">
              <button
                type="button"
                onClick={() => setSignupRequested(false)}
                className="font-medium text-brand hover:underline"
              >
                Use a different email
              </button>
              <span className="text-ink-muted">
                Already confirmed?{' '}
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className="font-medium text-brand hover:underline"
                >
                  Sign in
                </button>{' '}
                or{' '}
                <button
                  type="button"
                  onClick={() => switchMode('forgot')}
                  className="font-medium text-brand hover:underline"
                >
                  reset your password
                </button>
              </span>
            </div>
          </div>
        ) : mode === 'forgot' && resetRequested ? (
          <div className="mt-6 flex flex-col gap-4 text-center">
            <p className="text-sm text-ink-muted">
              If an account exists for <span className="font-medium text-ink">{email}</span>, a
              reset link is on its way. The link expires soon, so use it right away.
            </p>
            <button
              type="button"
              onClick={() => setResetRequested(false)}
              className="text-sm font-medium text-brand hover:underline"
            >
              Try a different email
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label htmlFor="auth-email" className="mb-1 block text-sm font-medium text-ink-muted">
                Email
              </label>
              <input
                id="auth-email"
                type="email"
                required
                className="input-field"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            {mode !== 'forgot' && (
              <div>
                <label
                  htmlFor="auth-password"
                  className="mb-1 block text-sm font-medium text-ink-muted"
                >
                  Password
                </label>
                <div className="relative">
                  <input
                    id="auth-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    className="input-field pr-10"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    aria-describedby={mode === 'signup' ? 'signup-password-requirements' : undefined}
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
                {mode === 'signup' && (
                  <div id="signup-password-requirements">
                    <PasswordRequirements password={password} />
                  </div>
                )}
              </div>
            )}

            {mode === 'login' && (
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                    className="h-4 w-4 rounded border-surface-border text-brand focus:ring-brand"
                  />
                  Remember me
                </label>
                <button
                  type="button"
                  onClick={() => switchMode('forgot')}
                  className="text-sm font-medium text-brand hover:underline"
                >
                  Forgot password?
                </button>
              </div>
            )}

            {mode === 'signup' && (
              <p className="text-center text-xs text-ink-muted">
                {legalCopyApproved ? 'By creating an account, you agree to our' : 'Review our'}{' '}
                <Link href="/terms" className="font-medium text-brand hover:underline">
                  Terms of Service
                </Link>{' '}
                and{' '}
                <Link href="/privacy" className="font-medium text-brand hover:underline">
                  Privacy Policy
                </Link>
                {legalCopyApproved ? '.' : ' (draft, pending approval).'}
              </p>
            )}

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
              {submitLabel}
            </button>

            {mode === 'login' && loginFailed && (
              <div role="alert" className="text-center text-sm text-ink-muted">
                <p aria-live="polite" className="sr-only">
                  {loginResend.cooldownAnnouncement}
                </p>
                <p>We could not sign you in with that email and password.</p>
                <p className="mt-1">
                  <button
                    type="button"
                    onClick={() => switchMode('forgot')}
                    className="font-medium text-brand hover:underline"
                  >
                    Reset your password
                  </button>
                  {' or '}
                  <button
                    type="button"
                    onClick={() => loginResend.resend(email)}
                    disabled={loginResend.isSending || loginResend.cooldownSeconds > 0}
                    className="font-medium text-brand hover:underline disabled:no-underline disabled:text-ink-subtle"
                  >
                    {loginResend.cooldownSeconds > 0
                      ? `resend your confirmation link (${loginResend.cooldownSeconds}s)`
                      : 'resend your confirmation link'}
                  </button>
                  .
                </p>
              </div>
            )}
          </form>
        )}

        <p className="mt-6 text-center text-sm text-ink-muted">
          {mode === 'login' && (
            <>
              Don&apos;t have an account?{' '}
              <button
                onClick={() => switchMode('signup')}
                className="font-medium text-brand hover:underline"
              >
                Sign up
              </button>
            </>
          )}
          {mode === 'signup' && !signupRequested && (
            <>
              Already have an account?{' '}
              <button
                onClick={() => switchMode('login')}
                className="font-medium text-brand hover:underline"
              >
                Sign in
              </button>
            </>
          )}
          {mode === 'forgot' && (
            <button
              onClick={() => switchMode('login')}
              className="font-medium text-brand hover:underline"
            >
              Back to sign in
            </button>
          )}
        </p>
      </div>
    </div>
  );
}
