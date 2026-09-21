'use client';

import { PASSWORD_RULES } from '@/lib/password-rules';

/** Live checklist against the shared password rules. Shown before submission, not after. */
export default function PasswordRequirements({ password }: { password: string }) {
  return (
    <ul className="mt-1 flex flex-col gap-0.5 text-xs" aria-label="Password requirements">
      {PASSWORD_RULES.map((rule) => {
        const met = rule.test(password);
        return (
          <li
            key={rule.id}
            className={met ? 'text-green-600' : 'text-ink-muted'}
            aria-label={`${rule.label}: ${met ? 'met' : 'not met'}`}
          >
            {met ? '✓' : '•'} {rule.label}
          </li>
        );
      })}
    </ul>
  );
}
