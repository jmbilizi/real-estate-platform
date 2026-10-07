'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
import { useApp } from '@/lib/context';
import { useToast } from '@/lib/useToast';
import {
  changeSignupEmail,
  CodesUnavailableError,
  CodeTiming,
  identifyEmail,
  RateLimitError,
  requestPasswordReset,
  SignInFailedError,
} from '@/lib/api/account';
import AuthCodeStep from '@/components/AuthCodeStep';
import AuthSetPasswordStep, { SetPasswordFailure } from '@/components/AuthSetPasswordStep';
import privacyContent from '@/content/legal/privacy.json';
import termsContent from '@/content/legal/terms.json';

// Neither page has approved copy yet, so the form must not claim a binding agreement to a page
// that says, on its own face, "carries no approved legal copy" (#156, #157).
const legalCopyApproved = !privacyContent.isDraft && !termsContent.isDraft;

/** Keyed by hostname so it never collides across environments or domains. */
function getRememberEmailKey() {
  return `cribstop_remember_email_${typeof window !== 'undefined' ? window.location.hostname : 'default'}`;
}

type Step = 'email' | 'password' | 'code' | 'setPassword' | 'forgot';

const UNAVAILABLE_COPY = 'Sign-up is unavailable right now. Try again soon.';

function entryError(err: unknown): string {
  if (err instanceof RateLimitError) {
    return `Too many tries. Try again in ${err.retryAfterSeconds} seconds.`;
  }
  if (err instanceof CodesUnavailableError) return UNAVAILABLE_COPY;
  return 'Something went wrong. Try again.';
}

const linkButton = 'inline-flex min-h-11 items-center font-medium text-brand hover:underline';

export default function AuthForm({
  initialMode = 'login',
  onSuccess,
  variant = 'page',
}: {
  /** 'forgot' opens the reset screen. The other values open the email-first flow. */
  initialMode?: 'login' | 'signup' | 'forgot';
  onSuccess?: () => void;
  /** 'page': always shows the card border/shadow. 'modal': plain on mobile, card on sm+ */
  variant?: 'page' | 'modal';
}) {
  const [step, setStep] = useState<Step>(initialMode === 'forgot' ? 'forgot' : 'email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Set on a 401 from /account/login. Wrong password and a lockout look the same on purpose.
  const [loginFailed, setLoginFailed] = useState(false);
  // Set once the forgot-password request has gone through. The confirmation shown for it must
  // stay neutral: the server never says whether the address has an account (#147).
  const [resetRequested, setResetRequested] = useState(false);
  const [codeTiming, setCodeTiming] = useState<CodeTiming>({
    resendAfterSeconds: 0,
    expiresInSeconds: 0,
  });
  // The address a code was sent to. A different address on the email step calls change-email.
  const [codeRun, setCodeRun] = useState(0);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  // The one-time sign-up proof. It lives in memory only: never in the URL, storage or logs.
  const [signupProof, setSignupProof] = useState<string | null>(null);
  const { login } = useApp();
  const { toast } = useToast();
  const router = useRouter();

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

  // Each step renders in the same position. Focus moves to its first field, or to the heading
  // when the step has none, so a screen reader follows the flow.
  const rootRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const field = rootRef.current?.querySelector<HTMLInputElement>(
      'form input:not([type="checkbox"]):not([readonly]):not([disabled])',
    );
    (field ?? headingRef.current)?.focus();
  }, [step, resetRequested]);

  const goToStep = (next: Step) => {
    setStep(next);
    setFormError(null);
    setLoginFailed(false);
    setResetRequested(false);
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const address = email.trim();
    if (!address) return;
    setFormError(null);
    setIsSubmitting(true);
    try {
      if (pendingEmail && pendingEmail.toLowerCase() !== address.toLowerCase()) {
        const timing = await changeSignupEmail(pendingEmail, address);
        setPendingEmail(address);
        setCodeTiming(timing);
        setCodeRun((n) => n + 1);
        goToStep('code');
        return;
      }
      const result = await identifyEmail(address);
      if (result.next === 'password') {
        setPendingEmail(null);
        goToStep('password');
      } else {
        setPendingEmail(address);
        setCodeTiming(result);
        setCodeRun((n) => n + 1);
        goToStep('code');
      }
    } catch (err) {
      setFormError(entryError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setLoginFailed(false);
    setIsSubmitting(true);
    try {
      await login(email, password, remember);
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
    } catch (err) {
      if (err instanceof SignInFailedError) {
        setLoginFailed(true);
      } else {
        toast(err instanceof Error ? err.message : 'Authentication request failed', 'error');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setIsSubmitting(true);
    try {
      await requestPasswordReset(email);
      setResetRequested(true);
    } catch (err) {
      if (err instanceof RateLimitError) {
        toast(`Too many requests. Try again in ${err.retryAfterSeconds} seconds.`, 'error');
      } else {
        toast('We could not send the request. Try again.', 'error');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerified = (proof: string) => {
    setSignupProof(proof);
    goToStep('setPassword');
  };

  const handleSetPasswordFailed = (reason: SetPasswordFailure) => {
    setSignupProof(null);
    setPendingEmail(null);
    goToStep('email');
    setFormError(
      reason === 'invalid_proof'
        ? 'That sign-up timed out. Start again.'
        : 'We could not finish sign-up. Start again, or sign in.',
    );
  };

  const handleSignedIn = () => {
    setSignupProof(null);
    toast('Welcome to Cribstop!');
    if (onSuccess) onSuccess();
    else router.push('/');
  };

  const showSocial = step === 'email';
  const emailChip = (
    <span className="break-words font-medium text-ink [overflow-wrap:anywhere]">{email}</span>
  );

  return (
    <div ref={rootRef} className="mx-auto w-full max-w-md">
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
          {step === 'email' && "What's your email?"}
          {step === 'password' && 'Welcome back'}
          {step === 'code' && 'Check your email'}
          {step === 'setPassword' && 'Last step'}
          {step === 'forgot' && 'Reset your password'}
        </h2>
        <p className="mt-2 text-center text-sm text-ink-muted">
          {step === 'email' && 'Sign in or join Cribstop. One email, no fuss.'}
          {step === 'password' && <>Welcome back. Enter your password for {emailChip}.</>}
          {step === 'code' && <>We sent a 6-digit code to {emailChip}.</>}
          {step === 'setPassword' && <>Pick a password for {emailChip}.</>}
          {step === 'forgot' &&
            (resetRequested
              ? 'Check your email for a link to reset your password'
              : "Enter your email and we'll send a reset link")}
        </p>

        {showSocial && (
          <div className="mt-6 flex flex-col gap-3">
            <button className="btn-secondary min-h-11 gap-2">
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
            <button className="btn-secondary min-h-11 gap-2">
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
              </svg>
              Continue with Apple
            </button>
            <div className="my-2 flex items-center gap-3">
              <div className="h-px flex-1 bg-surface-border" />
              <span className="text-xs text-ink-subtle">or</span>
              <div className="h-px flex-1 bg-surface-border" />
            </div>
          </div>
        )}

        {step === 'email' && (
          <form onSubmit={handleEmailSubmit} className="flex flex-col gap-4">
            <div>
              <label htmlFor="auth-email" className="mb-1 block text-sm font-medium text-ink-muted">
                Email
              </label>
              <input
                id="auth-email"
                type="email"
                required
                autoComplete="username"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                className="input-field min-h-11"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div aria-live="polite" className="empty:hidden text-center text-sm">
              {formError && (
                <p role="alert" className="text-red-600">
                  {formError}
                </p>
              )}
            </div>

            <button
              type="submit"
              className="btn-primary min-h-11 w-full py-3"
              disabled={isSubmitting}
              aria-busy={isSubmitting}
            >
              {isSubmitting ? 'Please wait...' : 'Continue'}
            </button>

            <p className="text-center text-xs text-ink-muted">
              {legalCopyApproved ? 'By continuing, you agree to our' : 'Review our'}{' '}
              <Link href="/terms" className="font-medium text-brand hover:underline">
                Terms of Service
              </Link>{' '}
              and{' '}
              <Link href="/privacy" className="font-medium text-brand hover:underline">
                Privacy Policy
              </Link>
              {legalCopyApproved ? '.' : ' (draft, pending approval).'}
            </p>
          </form>
        )}

        {step === 'password' && (
          <form onSubmit={handlePasswordSubmit} className="mt-6 flex flex-col gap-4">
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
                  autoComplete="current-password"
                  className="input-field min-h-11 pr-12"
                  placeholder="••••••••"
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

            <div className="flex flex-wrap items-center justify-between gap-x-4">
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="h-5 w-5 rounded border-surface-border text-brand focus:ring-brand"
                />
                Remember me
              </label>
              <button
                type="button"
                onClick={() => goToStep('forgot')}
                className={`${linkButton} text-sm`}
              >
                Forgot password?
              </button>
            </div>

            <button
              type="submit"
              className="btn-primary min-h-11 w-full py-3"
              disabled={isSubmitting}
              aria-busy={isSubmitting}
            >
              {isSubmitting ? 'Please wait...' : 'Sign in'}
            </button>

            <div aria-live="polite" className="empty:hidden text-center text-sm text-ink-muted">
              {loginFailed && (
                <p role="alert">We could not sign you in with that email and password.</p>
              )}
            </div>

            <div className="flex justify-center text-sm">
              <button type="button" onClick={() => goToStep('email')} className={linkButton}>
                Change email
              </button>
            </div>
          </form>
        )}

        {step === 'code' && (
          <div className="mt-6">
            <AuthCodeStep
              key={codeRun}
              email={email}
              resendAfterSeconds={codeTiming.resendAfterSeconds}
              expiresInSeconds={codeTiming.expiresInSeconds}
              onVerified={handleVerified}
              onChangeEmail={() => goToStep('email')}
            />
          </div>
        )}

        {step === 'setPassword' && signupProof && (
          <div className="mt-6">
            <AuthSetPasswordStep
              email={email}
              signupProof={signupProof}
              onSignedIn={handleSignedIn}
              onFailed={handleSetPasswordFailed}
            />
          </div>
        )}

        {step === 'forgot' &&
          (resetRequested ? (
            <div className="mt-6 flex flex-col gap-4 text-center">
              <p className="text-sm text-ink-muted">
                If an account exists for <span className="font-medium text-ink">{email}</span>, a
                reset link is on its way. The link expires soon, so use it right away.
              </p>
              <button
                type="button"
                onClick={() => setResetRequested(false)}
                className={`${linkButton} justify-center text-sm`}
              >
                Try a different email
              </button>
            </div>
          ) : (
            <form onSubmit={handleForgotSubmit} className="mt-6 flex flex-col gap-4">
              <div>
                <label
                  htmlFor="auth-reset-email"
                  className="mb-1 block text-sm font-medium text-ink-muted"
                >
                  Email
                </label>
                <input
                  id="auth-reset-email"
                  type="email"
                  required
                  autoComplete="username"
                  inputMode="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  className="input-field min-h-11"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <button
                type="submit"
                className="btn-primary min-h-11 w-full py-3"
                disabled={isSubmitting}
                aria-busy={isSubmitting}
              >
                {isSubmitting ? 'Please wait...' : 'Send Reset Link'}
              </button>
            </form>
          ))}

        {step === 'forgot' && (
          <p className="mt-6 text-center text-sm text-ink-muted">
            <button type="button" onClick={() => goToStep('email')} className={linkButton}>
              Back to sign in
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
