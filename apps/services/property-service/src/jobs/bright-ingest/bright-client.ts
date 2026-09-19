/**
 * The minimum Bright MLS client the scaffold needs: acquire an OAuth2 token, then pull `$metadata`.
 *
 * ## What this is, and what it deliberately is not
 *
 * This is a **connectivity probe**, not an ingestion client. It makes exactly two requests, keeps
 * nothing, parses nothing, and writes nothing. Paging, `$filter`/`ModificationTimestamp` cursors,
 * rate-limit handling and retry/backoff policy all belong to #92; mapping into the consumer schema
 * belongs to #93. A half-built replication loop shipped now would be worse than an honestly empty
 * one, because it would look finished.
 *
 * The probe earns its place for one reason: it is what turns "the credential is in the Secret" into
 * "the credential works", which is #117's definition of done (observe the job leave its
 * not-configured state) and the first item on the day-one checklist
 * (`docs/bright-mls-day-one-checklist.md` section 0). Without it the job could only report that a
 * non-placeholder string exists, which is not the same claim.
 *
 * ## Both request shapes are CONFIRMED against the live feed (2026-09-18, #163)
 *
 * They were assumptions inferred from public RESO and OAuth2 documentation until the test
 * credentials were run against Bright's staging feed. Both held, so nothing below changed:
 *
 *  - **Form-encoded `client_credentials` returns 200.** HTTP Basic also works, so the choice is
 *    ours rather than Bright's. `scope` is optional — the response reports `scope=clientcred`
 *    whether or not the request asks for it — so this client does not send one.
 *  - **`{serviceRoot}/$metadata` returns 200** with `OData-Version: 4.0`.
 *
 * The document that call returns is committed at `docs/bright-mls/bright-metadata.xml`. Read
 * `docs/bright-mls/README.md` before assuming anything about the resources it declares: the
 * property entity set is `BrightProperties`, not the RESO-standard `Property`, which does not exist
 * on this feed.
 *
 * Confirmed against the **test** tier only. A production-tier difference is a product-owner ping,
 * not a quiet local fix.
 */

import { createHash } from 'node:crypto';

import type { BrightCredentials, BrightEndpoint } from './config';

/** Default per-request ceiling. A scheduled job must not hang until the CronJob deadline kills it. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/** The subset of `fetch` this module uses, so tests need not stub the global. */
export type FetchLike = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export interface BrightClientOptions {
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
}

/**
 * RFC 6749 §5.2's closed set of `error` codes. Only these reach a log line.
 *
 * The neighbouring `error_description` is deliberately NOT carried, even though it is the more
 * useful field, because it is free text chosen by the server for a request that contained our client
 * id — and a gateway that answers `"Client 'abc123' not found"` would put that id straight into the
 * run log. That would quietly defeat the claim in `run-log.ts` that a credential has nowhere to go:
 * `message` is free-form, so anything routed onto it is effectively unredactable.
 *
 * An unrecognised code is reported as `unrecognized_error_code` rather than echoed, on the same
 * reasoning. If a 401 ever needs more detail than this, read the response in a one-off `kubectl run`
 * — do not widen what a scheduled job writes to stdout.
 */
const OAUTH_ERROR_CODES = new Set([
  'invalid_request',
  'invalid_client',
  'invalid_grant',
  'unauthorized_client',
  'unsupported_grant_type',
  'invalid_scope',
  'access_denied',
  'unsupported_response_type',
  'server_error',
  'temporarily_unavailable',
]);

/**
 * A failed Bright request. Carries the status and, when the body is an OAuth2 error object, the
 * standardised `error` CODE only. The raw body is deliberately not attached either: nothing
 * guarantees a gateway will not echo the request back, and an error path is the worst place to
 * discover that it does.
 */
export class BrightRequestError extends Error {
  readonly status: number;
  readonly host: string;

  constructor(params: {
    what: string;
    host: string;
    status: number;
    statusText: string;
    oauthError?: string | null;
  }) {
    const code =
      params.oauthError == null
        ? null
        : OAUTH_ERROR_CODES.has(params.oauthError)
          ? params.oauthError
          : 'unrecognized_error_code';
    super(
      `${params.what} failed against ${params.host}: HTTP ${params.status} ${params.statusText}` +
        (code === null ? '' : ` (${code})`),
    );
    this.name = 'BrightRequestError';
    this.status = params.status;
    this.host = params.host;
  }
}

export interface BrightToken {
  readonly accessToken: string;
  /** Seconds, as reported by Bright. `null` when the response omits it — a checklist item. */
  readonly expiresInSeconds: number | null;
}

export interface BrightMetadataProbe {
  /** The `OData-Version` response header, verbatim. `null` when Bright does not send one. */
  readonly odataVersion: string | null;
  readonly byteLength: number;
  /** Lets a later run say "the document changed" without keeping the document. */
  readonly sha256: string;
}

/** Reads RFC 6749's `error` CODE out of a body, if it is JSON at all. Nothing else is read. */
function readOAuthError(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed !== null && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      return typeof record.error === 'string' ? record.error : null;
    }
  } catch {
    // Not JSON. Status and statusText are all we can honestly report.
  }
  return null;
}

/**
 * Wraps a transport-level failure so the log says something usable.
 *
 * Node's global fetch rejects with the bare message `fetch failed` and hides the real reason —
 * DNS, TLS, connection refused, timeout — on `error.cause`. That message in a nightly run's log is
 * indistinguishable between "Bright is down", "the endpoint has a typo" and "egress is blocked",
 * which is three different people's problem. The host and the cause together separate them.
 */
async function withTransportContext<T>(
  what: string,
  host: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof BrightRequestError) {
      throw error;
    }
    const cause = (error as { cause?: unknown })?.cause;
    const causeMessage =
      cause instanceof Error ? cause.message : cause === undefined ? null : String(cause);
    const base = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${what} to ${host} failed at the transport layer: ${base}` +
        (causeMessage === null ? '' : ` (${causeMessage})`),
    );
  }
}

function resolveFetch(options: BrightClientOptions): FetchLike {
  const impl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike | undefined);
  if (typeof impl !== 'function') {
    throw new Error(
      'No fetch implementation is available. Node 20 provides a global fetch; pass fetchImpl to ' +
        'override it in tests.',
    );
  }
  return impl;
}

/**
 * Exchanges the client credentials for an access token.
 *
 * The secret leaves this function only in the request body, over HTTPS (enforced in `config.ts`). It
 * is never placed on a returned value, an error, or a log record.
 */
export async function acquireToken(
  endpoint: BrightEndpoint,
  credentials: BrightCredentials,
  options: BrightClientOptions = {},
): Promise<BrightToken> {
  const fetchImpl = resolveFetch(options);
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

  // Form-encoded client_credentials, confirmed 2026-09-18. No `scope` — Bright makes it optional.
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
  }).toString();

  const text = await withTransportContext(
    'Bright MLS token request',
    endpoint.tokenEndpointHost,
    async () => {
      const response = await fetchImpl(endpoint.tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });

      const payload = await response.text();
      if (!response.ok) {
        const oauthError = readOAuthError(payload);
        throw new BrightRequestError({
          what: 'Bright MLS token request',
          host: endpoint.tokenEndpointHost,
          status: response.status,
          statusText: response.statusText,
          oauthError,
        });
      }
      return payload;
    },
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      `Bright MLS token endpoint ${endpoint.tokenEndpointHost} returned a non-JSON body. ` +
        'It returned JSON on 2026-09-18, so this is a change at Bright rather than a wrong guess.',
    );
  }

  const record = (parsed ?? {}) as Record<string, unknown>;
  const accessToken = record.access_token;
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw new Error(
      `Bright MLS token endpoint ${endpoint.tokenEndpointHost} returned no access_token. ` +
        'It returned one on 2026-09-18, so this is a change at Bright rather than a wrong guess.',
    );
  }

  return {
    accessToken,
    expiresInSeconds: typeof record.expires_in === 'number' ? record.expires_in : null,
  };
}

/**
 * Pulls `{serviceRoot}/$metadata` and reports its shape without keeping or parsing it.
 *
 * The committed copy lives at `docs/bright-mls/bright-metadata.xml`. Keeping it current is a human
 * action, not something a CronJob should do to its own source tree — so compare the `sha256` this
 * probe logs against the one in `docs/bright-mls/README.md` to notice that Bright changed it.
 */
export async function probeMetadata(
  endpoint: BrightEndpoint,
  token: BrightToken,
  options: BrightClientOptions = {},
): Promise<BrightMetadataProbe> {
  const fetchImpl = resolveFetch(options);
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

  // `serviceRoot` is normalised by `new URL(...).toString()`, which keeps any trailing slash the
  // operator wrote and adds one to a bare origin — so strip before joining rather than guessing.
  const url = `${endpoint.serviceRoot.replace(/\/+$/, '')}/$metadata`;

  return withTransportContext(
    'Bright MLS $metadata request',
    endpoint.serviceRootHost,
    async () => {
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          Accept: 'application/xml',
        },
        signal: AbortSignal.timeout(timeoutMs),
      });

      const text = await response.text();

      if (!response.ok) {
        const oauthError = readOAuthError(text);
        throw new BrightRequestError({
          what: 'Bright MLS $metadata request',
          host: endpoint.serviceRootHost,
          status: response.status,
          statusText: response.statusText,
          oauthError,
        });
      }

      return {
        odataVersion: response.headers.get('OData-Version'),
        byteLength: Buffer.byteLength(text, 'utf8'),
        sha256: createHash('sha256').update(text, 'utf8').digest('hex'),
      };
    },
  );
}
