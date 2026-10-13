/**
 * The one client-side definition of the password policy. Mirrors account-service
 * `PasswordPolicyValidator`: a password is valid with `minLength`+ characters and one of each
 * character class, or with `passphraseLength`+ characters and no other rule. The server stays the
 * gate. Forms import this file rather than restating the rules.
 */
export type PasswordClass = 'upper' | 'lower' | 'digit' | 'symbol';

export interface PasswordPolicy {
  minLength: number;
  passphraseLength: number;
  requiredClasses: PasswordClass[];
}

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 8,
  passphraseLength: 15,
  requiredClasses: ['upper', 'lower', 'digit', 'symbol'],
};

const CLASS_LABELS: Record<PasswordClass, string> = {
  upper: 'An uppercase letter',
  lower: 'A lowercase letter',
  digit: 'A number',
  symbol: 'A symbol',
};

const CLASS_TESTS: Record<PasswordClass, (password: string) => boolean> = {
  upper: (password) => /\p{Lu}/u.test(password),
  lower: (password) => /\p{Ll}/u.test(password),
  digit: (password) => /\p{Nd}/u.test(password),
  symbol: (password) => /[^\p{L}\p{Nd}]/u.test(password),
};

export interface PasswordRuleStatus {
  id: 'length' | PasswordClass;
  label: string;
  met: boolean;
}

export interface PasswordCheck {
  rules: PasswordRuleStatus[];
  /** True when the password has `passphraseLength`+ characters. */
  passphrase: boolean;
  valid: boolean;
}

/** Checks a password. At passphrase length every rule reads as met. */
export function checkPassword(
  password: string,
  policy: PasswordPolicy = DEFAULT_PASSWORD_POLICY,
): PasswordCheck {
  const passphrase = password.length >= policy.passphraseLength;
  const rules: PasswordRuleStatus[] = [
    {
      id: 'length',
      label: `${policy.minLength}+ characters`,
      met: passphrase || password.length >= policy.minLength,
    },
    ...policy.requiredClasses.map((id) => ({
      id,
      label: CLASS_LABELS[id],
      met: passphrase || CLASS_TESTS[id](password),
    })),
  ];
  return { rules, passphrase, valid: rules.every((rule) => rule.met) };
}

export function passphraseHint(policy: PasswordPolicy = DEFAULT_PASSWORD_POLICY): string {
  return `Or use ${policy.passphraseLength}+ characters, no other rules.`;
}

export function passwordMeetsRules(
  password: string,
  policy: PasswordPolicy = DEFAULT_PASSWORD_POLICY,
): boolean {
  return checkPassword(password, policy).valid;
}
