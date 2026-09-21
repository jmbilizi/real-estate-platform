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

export interface IntrospectionClient {
  /** Resolves the forwarded credential to an account id, or `null` when signed out or invalid. */
  resolveAccountId(headers: CredentialHeaders): Promise<string | null>;
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
  return {
    async resolveAccountId(headers: CredentialHeaders): Promise<string | null> {
      if (!hasAnyCredential(headers)) {
        return null;
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
          return null;
        }

        const body = (await response.json()) as IntrospectionResponseBody;
        return body.isValid === true && typeof body.accountId === 'string' ? body.accountId : null;
      } catch (error) {
        console.warn('Credential introspection failed; treating the request as signed-out.', error);
        return null;
      }
    },
  };
}
