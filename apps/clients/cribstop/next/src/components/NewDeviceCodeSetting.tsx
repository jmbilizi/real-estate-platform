'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AuthError,
  CodesUnavailableError,
  getNewDeviceSetting,
  type NewDeviceSetting,
  RateLimitError,
  removeTrustedDevice,
  setNewDeviceSetting,
} from '@/lib/api/account';
import { useCountdown } from '@/lib/useCountdown';

function day(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * The "email code on a new device" switch and the device list (#818). Changing the switch needs
 * the current password. A wrong password counts toward the sign-in lock.
 */
export default function NewDeviceCodeSetting() {
  const [setting, setSetting] = useState<NewDeviceSetting | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  // The value the user asked for. Null while no password prompt shows.
  const [target, setTarget] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useCountdown(0);
  const passwordRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setSetting(await getNewDeviceSetting());
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (target !== null) passwordRef.current?.focus();
  }, [target]);

  const close = () => {
    setTarget(null);
    setPassword('');
    setError(null);
  };

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (target === null || !password || busy || lock.seconds > 0) return;
    setError(null);
    setBusy(true);
    try {
      const outcome = await setNewDeviceSetting(target, password);
      if (outcome.ok) {
        close();
        await load();
      } else {
        setError('That password did not work.');
        setPassword('');
        passwordRef.current?.focus();
      }
    } catch (err) {
      if (err instanceof RateLimitError) {
        lock.start(err.retryAfterSeconds);
        setError(`Too many tries. Try again in ${err.retryAfterSeconds} seconds.`);
      } else if (err instanceof CodesUnavailableError) {
        setError('Email codes are unavailable right now. Try again soon.');
      } else if (err instanceof AuthError) {
        setError('Sign in again to change this setting.');
      } else {
        setError('We could not change this setting. Try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  const signOutDevice = async (id: string) => {
    try {
      await removeTrustedDevice(id);
      await load();
    } catch {
      setError('We could not sign that device out. Try again.');
    }
  };

  const enabled = setting?.enabled === true;

  return (
    <li className="px-5 py-3">
      <label className="flex min-h-11 items-start gap-3">
        <input
          type="checkbox"
          role="switch"
          className="mt-1 h-5 w-5 shrink-0"
          checked={target ?? enabled}
          disabled={setting === null || busy}
          aria-describedby="new-device-help"
          onChange={(e) => {
            setError(null);
            setPassword('');
            setTarget(e.target.checked === enabled ? null : e.target.checked);
          }}
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium text-ink">
            Ask for an email code when I sign in on a new device
          </span>
          <span id="new-device-help" className="block text-xs text-ink-muted">
            We email a 6-digit code before you sign in on a device we do not know. A device you
            approve skips the code for 30 days.
          </span>
        </span>
      </label>

      {loadFailed && setting === null && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          We could not load this setting.{' '}
          <button type="button" onClick={() => void load()} className="font-medium underline">
            Try again
          </button>
        </p>
      )}

      {target !== null && (
        <form
          onSubmit={confirm}
          className="mt-3 flex flex-col gap-3 border-t border-surface-border pt-4"
        >
          <div>
            <label
              htmlFor="new-device-password"
              className="mb-1 block text-sm font-medium text-ink-muted"
            >
              Confirm your password to turn this {target ? 'on' : 'off'}
            </label>
            <input
              id="new-device-password"
              ref={passwordRef}
              type="password"
              required
              autoComplete="current-password"
              className="input-field min-h-11"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div aria-live="polite" className="empty:hidden text-sm">
            {error && (
              <p role="alert" className="text-red-600">
                {error}
              </p>
            )}
          </div>
          <button
            type="submit"
            className="btn-primary min-h-11 w-full py-3 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!password || busy || lock.seconds > 0}
            aria-busy={busy}
          >
            {busy ? 'Please wait...' : target ? 'Turn on' : 'Turn off'}
          </button>
          <button
            type="button"
            onClick={close}
            className="inline-flex min-h-11 items-center justify-center text-sm font-medium text-ink-muted hover:text-ink"
          >
            Cancel
          </button>
        </form>
      )}

      {target === null && error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}

      {enabled && setting && (
        <div className="mt-3">
          <p className="text-xs font-medium text-ink-muted">Approved devices</p>
          {setting.devices.length === 0 ? (
            <p className="mt-1 text-sm text-ink-muted">No approved devices.</p>
          ) : (
            <ul className="mt-1 divide-y divide-surface-border">
              {setting.devices.map((device) => (
                <li key={device.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-medium text-ink">
                      {device.label}
                      {device.current && (
                        <span className="ml-2 rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">
                          This device
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-ink-muted">
                      First seen {day(device.firstSeenAt)}. Last used {day(device.lastUsedAt)}.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void signOutDevice(device.id)}
                    aria-label={`Sign out ${device.label}`}
                    className="inline-flex min-h-11 min-w-11 flex-shrink-0 items-center justify-center rounded-full px-3 text-sm font-medium text-brand hover:bg-brand/10"
                  >
                    Sign out
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
