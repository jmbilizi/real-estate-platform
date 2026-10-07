'use client';

import { useState } from 'react';
import { useAppSelector } from '@/lib/store/hooks';
import { selectUser } from '@/lib/store/selectors';
import ChangeEmailFlow from '@/components/ChangeEmailFlow';
import ChangePasswordFlow from '@/components/ChangePasswordFlow';

type Panel = 'email' | 'password' | null;

/** The Email and Password rows of account settings. Each Change opens its flow in place. */
export default function AccountSecuritySection() {
  const user = useAppSelector(selectUser);
  const [open, setOpen] = useState<Panel>(null);
  if (!user) return null;

  const row = (panel: Exclude<Panel, null>, label: string, value: string) => {
    const expanded = open === panel;
    return (
      <li className="px-5 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-ink-muted">{label}</p>
            <p className="break-words text-sm font-medium text-ink">{value}</p>
          </div>
          {!expanded && (
            <button
              type="button"
              onClick={() => setOpen(panel)}
              aria-label={`Change ${label.toLowerCase()}`}
              className="inline-flex min-h-11 min-w-11 flex-shrink-0 items-center justify-center rounded-full px-3 text-sm font-medium text-brand hover:bg-brand/10"
            >
              Change
            </button>
          )}
        </div>
        {expanded && (
          <div className="mt-3 border-t border-surface-border pt-4">
            {panel === 'email' ? (
              <ChangeEmailFlow onClose={() => setOpen(null)} />
            ) : (
              <ChangePasswordFlow email={user.email} onClose={() => setOpen(null)} />
            )}
          </div>
        )}
      </li>
    );
  };

  return (
    <section
      aria-labelledby="sign-in-security-heading"
      className="mt-10 rounded-2xl border border-surface-border bg-white shadow-card"
    >
      <div className="border-b border-surface-border px-5 py-4">
        <h2
          id="sign-in-security-heading"
          className="text-sm font-semibold uppercase tracking-wide text-ink-muted"
        >
          Sign-in and security
        </h2>
      </div>
      <ul className="divide-y divide-surface-border">
        {row('email', 'Email', user.email)}
        {row('password', 'Password', '••••••••••')}
      </ul>
    </section>
  );
}
