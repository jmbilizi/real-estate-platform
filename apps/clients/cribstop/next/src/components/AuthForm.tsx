'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/context';

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
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { login, signup } = useApp();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      if (mode === 'login') {
        await login(email, password);
        if (onSuccess) onSuccess();
        else router.push('/');
      } else if (mode === 'signup') {
        await signup(name, username, email, password);
        if (onSuccess) onSuccess();
        else router.push('/');
      } else {
        alert('Password reset link sent to ' + email);
        setMode('login');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication request failed');
    } finally {
      setIsSubmitting(false);
    }
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
            ? 'w-full p-6 sm:rounded-3xl sm:border sm:border-surface-border sm:bg-white sm:p-10 sm:shadow-pop'
            : 'rounded-3xl border border-surface-border bg-white p-8 shadow-pop sm:p-10'
        }
      >
        <h2 className="text-center font-display text-2xl font-bold tracking-tight">
          {mode === 'login' && 'Welcome back'}
          {mode === 'signup' && 'Create your account'}
          {mode === 'forgot' && 'Reset your password'}
        </h2>
        <p className="mt-2 text-center text-sm text-ink-muted">
          {mode === 'login' && 'Sign in to save homes and set alerts'}
          {mode === 'signup' && 'Join us to find your dream home'}
          {mode === 'forgot' && "Enter your email and we'll send a reset link"}
        </p>

        {mode !== 'forgot' && (
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

        {mode !== 'forgot' && (
          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-surface-border" />
            <span className="text-xs text-ink-subtle">or</span>
            <div className="h-px flex-1 bg-surface-border" />
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {mode === 'signup' && (
            <div>
              <label className="mb-1 block text-sm font-medium text-ink-muted">Full Name</label>
              <input
                type="text"
                required
                className="input-field"
                placeholder="Jane Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          )}

          {mode === 'signup' && (
            <div>
              <label className="mb-1 block text-sm font-medium text-ink-muted">Username</label>
              <input
                type="text"
                required
                className="input-field"
                placeholder="janedoe"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-ink-muted">Email</label>
            <input
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
              <label className="mb-1 block text-sm font-medium text-ink-muted">Password</label>
              <input
                type="password"
                required
                className="input-field"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
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
                onClick={() => setMode('forgot')}
                className="text-sm font-medium text-brand hover:underline"
              >
                Forgot password?
              </button>
            </div>
          )}

          <button
            type="submit"
            className="btn-primary mt-2 w-full py-3"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
          >
            {submitLabel}
          </button>
          {error && (
            <p className="text-sm text-red-600" role="alert" aria-live="polite">
              {error}
            </p>
          )}
        </form>

        <p className="mt-6 text-center text-sm text-ink-muted">
          {mode === 'login' && (
            <>
              Don&apos;t have an account?{' '}
              <button
                onClick={() => {
                  setMode('signup');
                  onSwitchMode?.('signup');
                }}
                className="font-medium text-brand hover:underline"
              >
                Sign up
              </button>
            </>
          )}
          {mode === 'signup' && (
            <>
              Already have an account?{' '}
              <button
                onClick={() => {
                  setMode('login');
                  onSwitchMode?.('login');
                }}
                className="font-medium text-brand hover:underline"
              >
                Sign in
              </button>
            </>
          )}
          {mode === 'forgot' && (
            <button
              onClick={() => {
                setMode('login');
                onSwitchMode?.('login');
              }}
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
