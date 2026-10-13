'use client';

import { Check } from 'lucide-react';
import { checkPassword, passphraseHint, type PasswordPolicy } from '@/lib/password-rules';

/**
 * Live checklist against the shared password rules. Every row always renders, so the height does
 * not change while the user types. A row changes colour and icon only.
 */
export default function PasswordRequirements({
  id,
  password,
  policy,
}: {
  id: string;
  password: string;
  policy: PasswordPolicy;
}) {
  const { rules, passphrase } = checkPassword(password, policy);
  return (
    <div id={id} className="mt-1.5 text-xs">
      <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5" aria-label="Password requirements">
        {rules.map((rule) => (
          <li
            key={rule.id}
            className={`flex items-center gap-1 ${rule.met ? 'text-green-700' : 'text-ink-muted'}`}
            data-met={rule.met}
          >
            {rule.met ? (
              <Check className="h-3 w-3 shrink-0" aria-hidden="true" />
            ) : (
              <span
                className="inline-block h-3 w-3 shrink-0 text-center leading-3"
                aria-hidden="true"
              >
                •
              </span>
            )}
            <span>
              {rule.label}
              <span className="sr-only">{rule.met ? ': met' : ': not met'}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className={`mt-1 ${passphrase ? 'text-green-700' : 'text-ink-muted'}`}>
        {passphraseHint(policy)}
      </p>
    </div>
  );
}
