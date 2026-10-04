/**
 * Server-to-server client for account-service's credential introspection endpoint (#86), used to
 * resolve a signed-in consumer's account id without requiring sign-in.
 *
 * Kept local to this feature rather than in `libs/`: #86 itself flags a shared client as a
 * follow-up chore once a second Node service needs the same pattern, not part of the first
 * implementation.
 */

const API_KEY_HEADER = 'X-Api-Key';

/** The forwarded credential headers, exactly as the gateway forwards them (PRD §11.1). */
export interface CredentialHeaders {
  cookie?: string;
  authorization?: string;
  apiKey?: string;
}

/** What account-service said. `unavailable` means it gave no answer, which is not "signed out". */
export type IntrospectionOutcome =
  | { readonly kind: 'account'; readonly accountId: string }
  | { readonly kind: 'signed-out' }
  | { readonly kind: 'unavailable' };

export interface IntrospectionClient {
  /** Resolves the forwarded credential to an account id, or `null` when signed out or invalid. */
  resolveAccountId(headers: CredentialHeaders): Promise<string | null>;
  /**
   * Same call, but an outage stays visible as `unavailable`. A route that must not read an outage
   * as "signed out" (saved homes, #23) uses this. A client without it is treated as always up.
   */
  introspect?(headers: CredentialHeaders): Promise<IntrospectionOutcome>;
}

function hasAnyCredential(headers: CredentialHeaders): boolean {
  return Boolean(headers.cookie || headers.authorization || headers.apiKey);
}

interface IntrospectionResponseBody {
  isValid?: boolean;
  accountId?: string | null;
}

export interface HttpIntrospectionClientOptions {
  /** account-service's internal introspection URL — see `ACCOUNT_SERVICE_INTROSPECT_URL`. */
  url: string;
  timeoutMs: number;
}

/**
 * The real client: forwards whichever credential headers are present, verbatim, to
 * account-service. Account-service already tries API key → bearer → cookie itself and reports
 * the first valid one, so there is nothing to choose between here.
 *
 * Fails OPEN to "signed out" on any network error, timeout, or non-2xx response — never to a
 * rejected inquiry. account-service being slow or unreachable must not block this ticket's
 * primary conversion path; the worst outcome is a signed-in consumer's inquiry recorded with no
 * account id, which is the same shape this endpoint already supports for a signed-out caller.
 */
export function createHttpIntrospectionClient(
  options: HttpIntrospectionClientOptions,
): IntrospectionClient {
  async function introspect(headers: CredentialHeaders): Promise<IntrospectionOutcome> {
    if (!hasAnyCredential(headers)) {
      return { kind: 'signed-out' };
    }

    try {
      const response = await fetch(options.url, {
        method: 'POST',
        headers: {
          ...(headers.cookie ? { Cookie: headers.cookie } : {}),
          ...(headers.authorization ? { Authorization: headers.authorization } : {}),
          ...(headers.apiKey ? { [API_KEY_HEADER]: headers.apiKey } : {}),
        },
        signal: AbortSignal.timeout(options.timeoutMs),
      });

      if (!response.ok) {
        return { kind: 'unavailable' };
      }

      const body = (await response.json()) as IntrospectionResponseBody;
      return body.isValid === true && typeof body.accountId === 'string'
        ? { kind: 'account', accountId: body.accountId }
        : { kind: 'signed-out' };
    } catch (error) {
      console.warn('Credential introspection failed.', error);
      return { kind: 'unavailable' };
    }
  }

  return {
    async resolveAccountId(headers: CredentialHeaders): Promise<string | null> {
      const outcome = await introspect(headers);
      return outcome.kind === 'account' ? outcome.accountId : null;
    },
    introspect,
  };
}
