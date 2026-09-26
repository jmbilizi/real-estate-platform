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
import { backoffDelayMs, isRetryableStatus, type RateLimiter } from './rate-limiter';

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
  /**
   * The OData `error.message` of a failed PAGE request, trimmed to 300 characters, or null. Set
   * only by `fetchPage`, never by the token call, whose body can echo a client id. A query error
   * ("Query Too Complex", a type mismatch) is what tells us which filter shape Bright accepts.
   */
  readonly odataMessage: string | null;

  constructor(params: {
    what: string;
    host: string;
    status: number;
    statusText: string;
    oauthError?: string | null;
    odataMessage?: string | null;
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
    this.odataMessage = params.odataMessage ?? null;
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

/** The OData v4 `error.message` of a failure body, trimmed, or null. Page requests only. */
function readODataMessage(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    const error = (parsed as { error?: { message?: unknown } } | null)?.error;
    return typeof error?.message === 'string' ? error.message.slice(0, 300) : null;
  } catch {
    return null;
  }
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

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * Replication (#92). Everything above this line is #91's connectivity probe and is unchanged.
 * ════════════════════════════════════════════════════════════════════════════════════════════ */

/** One OData page. `nextLink` is `@odata.nextLink`, absent on the last page. */
export interface BrightPage {
  readonly records: readonly Record<string, unknown>[];
  readonly nextLink: string | null;
}

export interface BrightPageOptions extends BrightClientOptions {
  /** Shared across the whole run. One limiter, or two callers each stay under and together exceed. */
  readonly limiter?: RateLimiter;
  readonly maxRetries?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Injected so a test asserts the backoff schedule without waiting for it. */
  readonly random?: () => number;
  /** Called once per retried attempt, so the run report can count retries. */
  readonly onRetry?: (attempt: number, status: number) => void;
}

/** Supplies a valid access token, refreshing it when it is close to expiring. */
export type TokenProvider = () => Promise<BrightToken>;

/**
 * Bright's tokens report `expires_in=3600`. A backfill run can outlive that.
 *
 * Refreshing 120 seconds early is not a guess about clock skew — it is the window in which a token
 * that validated when the request was built expires while the request is in flight. That failure
 * arrives as a 401 in the middle of a page loop, which is indistinguishable from a revoked
 * credential and would otherwise be retried against a ceiling nobody wants to spend on it.
 */
const TOKEN_REFRESH_MARGIN_MS = 120_000;

export function createTokenProvider(
  endpoint: BrightEndpoint,
  credentials: BrightCredentials,
  options: BrightClientOptions & { readonly now?: () => number } = {},
): TokenProvider {
  const now = options.now ?? (() => Date.now());
  let cached: { token: BrightToken; expiresAt: number } | null = null;
  let pending: Promise<BrightToken> | null = null;

  return async () => {
    if (cached !== null && now() < cached.expiresAt) {
      return cached.token;
    }
    // Collapse concurrent refreshes. Two page fetches noticing the same expiry must not each spend a
    // token request from the shared budget.
    pending ??= (async () => {
      const token = await acquireToken(endpoint, credentials, options);
      const lifetimeMs = (token.expiresInSeconds ?? 3600) * 1000;
      cached = { token, expiresAt: now() + Math.max(0, lifetimeMs - TOKEN_REFRESH_MARGIN_MS) };
      return token;
    })().finally(() => {
      pending = null;
    });
    return pending;
  };
}

/**
 * Parses `url` and refuses to send the Bright bearer token anywhere but `allowedHost` over HTTPS.
 *
 * Shared by `fetchPage` and `fetchCount` so the one security-relevant check — host pinning — has
 * one definition. `url` is either built locally (`odata-query.ts`) or is an `@odata.nextLink` Bright
 * returned; either way, a host change is either a feed misconfiguration or an attempt to collect our
 * bearer token, and a non-HTTPS URL would send it in the clear.
 */
function assertAllowedHost(url: string, allowedHost: string, what: string): URL {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error(`${what} is not an absolute URL, against ${allowedHost}: ${url}`);
  }
  if (parsedUrl.host !== allowedHost) {
    throw new Error(
      `Refusing to send the Bright access token to ${parsedUrl.host}: the configured service root ` +
        `is ${allowedHost}. ${what} is server-supplied or config-derived, so a host change is ` +
        'either a misconfiguration or an attempt to collect our bearer token.',
    );
  }
  if (parsedUrl.protocol !== 'https:') {
    throw new Error(`Refusing to send the Bright access token over ${parsedUrl.protocol}//.`);
  }
  return parsedUrl;
}

/**
 * Fetches one page.
 *
 * `url` is either built by `odata-query.ts` or is an `@odata.nextLink` Bright returned. The second
 * case is why `allowedHost` exists: a nextLink is a server-supplied URL, and this request carries a
 * bearer token. A feed that answered with a nextLink pointing somewhere else would otherwise hand
 * our credential to that somewhere else, and the run would look entirely normal while doing it. The
 * host is pinned to the configured service root and a mismatch fails the run.
 *
 * Retries only a 429 or a 5xx, with jittered backoff. Every attempt passes through the same limiter,
 * so a retry storm cannot exceed the ceiling either.
 */
export async function fetchPage(
  url: string,
  tokenProvider: TokenProvider,
  allowedHost: string,
  options: BrightPageOptions = {},
): Promise<BrightPage> {
  const fetchImpl = resolveFetch(options);
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? 5;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  assertAllowedHost(url, allowedHost, 'An @odata.nextLink');

  let lastStatus = 0;
  let lastStatusText = '';

  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    const token = await tokenProvider();
    const run = async () => {
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      return { response, body: await response.text() };
    };

    const { response, body } = await withTransportContext(
      'Bright MLS page request',
      allowedHost,
      () => (options.limiter === undefined ? run() : options.limiter.schedule(run)),
    );

    if (response.ok) {
      return parsePage(body, allowedHost);
    }

    lastStatus = response.status;
    lastStatusText = response.statusText;

    if (!isRetryableStatus(response.status) || attempt === maxRetries + 1) {
      throw new BrightRequestError({
        what: 'Bright MLS page request',
        host: allowedHost,
        status: response.status,
        statusText: response.statusText,
        oauthError: readOAuthError(body),
        odataMessage: readODataMessage(body),
      });
    }

    options.onRetry?.(attempt, response.status);
    await sleep(backoffDelayMs(attempt, options.random));
  }

  // Unreachable: the loop either returns or throws. Kept so the signature needs no non-null cast.
  throw new BrightRequestError({
    what: 'Bright MLS page request',
    host: allowedHost,
    status: lastStatus,
    statusText: lastStatusText,
  });
}

/**
 * Fetches one `$count` request (#328) and returns the row count.
 *
 * `url` is always built by `odata-query.ts`'s `buildAreaCountQuery`, never a server-supplied link,
 * but the host/protocol are still pinned to `allowedHost` — the same rule `fetchPage` enforces, so
 * a config mistake here fails the same way a nextLink mismatch would.
 *
 * OData v4's `$count` segment returns the count as a bare integer text body, not a JSON envelope, so
 * this does not go through `parsePage`. No retry loop: this is a diagnostic read run interactively
 * against a handful of cities and statuses, not a scheduled job competing for a rate-limit budget.
 */
export async function fetchCount(
  url: string,
  tokenProvider: TokenProvider,
  allowedHost: string,
  options: BrightClientOptions = {},
): Promise<number> {
  const fetchImpl = resolveFetch(options);
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

  assertAllowedHost(url, allowedHost, 'A Bright count query');

  const token = await tokenProvider();
  const { response, body } = await withTransportContext(
    'Bright MLS count request',
    allowedHost,
    async () => {
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          Accept: 'text/plain',
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      return { response, body: await response.text() };
    },
  );

  if (!response.ok) {
    throw new BrightRequestError({
      what: 'Bright MLS count request',
      host: allowedHost,
      status: response.status,
      statusText: response.statusText,
      oauthError: readOAuthError(body),
      odataMessage: readODataMessage(body),
    });
  }

  const trimmed = body.trim();
  // `Number('')` is 0, not NaN, so an empty body (a truncated response, a proxy hiccup) would
  // otherwise read as a real zero count and the audit would report a false gap for that city.
  const count = trimmed.length === 0 ? NaN : Number(trimmed);
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(
      `Bright MLS count request to ${allowedHost} returned a non-numeric body: ` +
        `"${trimmed.slice(0, 100)}"`,
    );
  }
  return count;
}

/**
 * Reads an OData collection response.
 *
 * Only `value` and `@odata.nextLink` are read. Nothing else on the envelope is kept, and no record
 * field is inspected here — the payload goes to staging verbatim and #93 interprets it.
 */
function parsePage(body: string, host: string): BrightPage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(
      `Bright MLS page response from ${host} is not JSON. The request asked for ` +
        'application/json and the 2026-09-18 probes returned it.',
    );
  }

  const envelope = (parsed ?? {}) as Record<string, unknown>;
  const value = envelope.value;
  if (!Array.isArray(value)) {
    throw new Error(
      `Bright MLS page response from ${host} has no "value" array. An OData collection response ` +
        'always carries one, so this is a change at Bright or a non-collection endpoint.',
    );
  }

  const nextLink = envelope['@odata.nextLink'];
  return {
    records: value as Record<string, unknown>[],
    nextLink: typeof nextLink === 'string' && nextLink.length > 0 ? nextLink : null,
  };
}
