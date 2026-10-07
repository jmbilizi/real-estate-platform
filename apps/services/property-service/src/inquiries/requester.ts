import type { CredentialHeaders, IntrospectionClient } from './account-introspection';

export interface Requester {
  accountId: string | null;
  /** True only when the credential resolves to an account with a confirmed email. */
  verifiedAccount: boolean;
  /** The account email. Set only when `verifiedAccount`. It replaces any email in the body. */
  accountEmail: string | null;
}

const SIGNED_OUT: Requester = { accountId: null, verifiedAccount: false, accountEmail: null };

/**
 * The one place that decides `verified_account` (#627). The request body never reaches it.
 *
 * An outage reads as signed out, so a request still goes through. A client without `introspect`
 * gives an account id only, never a verified account.
 */
export async function resolveRequester(
  introspection: IntrospectionClient,
  headers: CredentialHeaders,
): Promise<Requester> {
  if (!introspection.introspect) {
    const accountId = await introspection.resolveAccountId(headers);
    return { ...SIGNED_OUT, accountId };
  }
  const outcome = await introspection.introspect(headers);
  if (outcome.kind !== 'account') return SIGNED_OUT;
  const verified = outcome.emailConfirmed === true && Boolean(outcome.email);
  return {
    accountId: outcome.accountId,
    verifiedAccount: verified,
    accountEmail: verified ? (outcome.email ?? null) : null,
  };
}
