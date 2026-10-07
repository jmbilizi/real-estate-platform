import type { CredentialHeaders, IntrospectionClient } from './account-introspection';

export interface Requester {
  accountId: string | null;
  /** True only when the credential resolves to an account with a confirmed email. */
  verifiedAccount: boolean;
}

/**
 * The one place that decides `verified_account` (#627). The request body never reaches it.
 *
 * Until the roles ticket (#628) makes account-service report email confirmation, no account
 * counts as verified. When the signal arrives, only this function changes.
 */
export async function resolveRequester(
  introspection: IntrospectionClient,
  headers: CredentialHeaders,
): Promise<Requester> {
  const accountId = await introspection.resolveAccountId(headers);
  return { accountId, verifiedAccount: false };
}
