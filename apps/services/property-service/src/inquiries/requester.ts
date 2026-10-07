import type { CredentialHeaders, IntrospectionClient } from './account-introspection';

/** Who sends a request. Every state but `account` ends the request before any write. */
export type Requester =
  | { kind: 'account'; accountId: string; accountEmail: string }
  | { kind: 'signed-out' }
  | { kind: 'unconfirmed' }
  | { kind: 'unavailable' };

/**
 * The one place that decides who sends a request (#627, #690). The request body never reaches it.
 *
 * An account counts only with a confirmed email. The contact email comes from the account.
 * A client without `introspect` gives an account id and no email, which reads as `unconfirmed`.
 */
export async function resolveRequester(
  introspection: IntrospectionClient,
  headers: CredentialHeaders,
): Promise<Requester> {
  if (!introspection.introspect) {
    const accountId = await introspection.resolveAccountId(headers);
    return accountId ? { kind: 'unconfirmed' } : { kind: 'signed-out' };
  }
  const outcome = await introspection.introspect(headers);
  if (outcome.kind === 'unavailable') return { kind: 'unavailable' };
  if (outcome.kind !== 'account') return { kind: 'signed-out' };
  if (outcome.emailConfirmed !== true || !outcome.email) return { kind: 'unconfirmed' };
  return { kind: 'account', accountId: outcome.accountId, accountEmail: outcome.email };
}
