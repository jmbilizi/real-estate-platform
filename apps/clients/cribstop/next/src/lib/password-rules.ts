/**
 * The one client-side definition of the password policy.
 *
 * account-service does not override ASP.NET Core Identity's `PasswordOptions`, so these are
 * Identity's defaults (6+ characters, one upper, one lower, one digit, one symbol). Keep this the
 * only copy: a form that shows password rules imports this file rather than restating the list, so
 * the client and the server (and every form on the client) cannot drift apart.
 */
export interface PasswordRule {
  id: string;
  label: string;
  test: (password: string) => boolean;
}

export const PASSWORD_RULES: PasswordRule[] = [
  { id: 'length', label: 'At least 6 characters', test: (password) => password.length >= 6 },
  { id: 'upper', label: 'One uppercase letter', test: (password) => /[A-Z]/.test(password) },
  { id: 'lower', label: 'One lowercase letter', test: (password) => /[a-z]/.test(password) },
  { id: 'digit', label: 'One number', test: (password) => /[0-9]/.test(password) },
  { id: 'symbol', label: 'One symbol', test: (password) => /[^A-Za-z0-9]/.test(password) },
];

export function passwordMeetsRules(password: string): boolean {
  return PASSWORD_RULES.every((rule) => rule.test(password));
}
