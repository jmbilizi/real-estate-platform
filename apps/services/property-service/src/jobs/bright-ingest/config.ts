/**
 * Configuration and credential resolution for the Bright MLS ingestion job (#91).
 *
 * This module answers one question — **which feed are we pointed at, and do we hold a credential for
 * it?** — and deliberately answers nothing else. There is no sync logic here and none anywhere else
 * in `src/jobs/bright-ingest/`; incremental replication is #92 and mapping into the consumer schema
 * is #93. What exists today is the vehicle those two drop into.
 *
 * ## Two credential sets, never one (stakeholder ruling 2026-09-12, recorded on #117)
 *
 * `dev` authenticates against Bright's **test/staging** feed; `prod` authenticates against the
 * **licensed production** feed; `test` and `local` get no Bright credentials at all. Three
 * consequences are implemented here rather than left to convention:
 *
 *  1. **The endpoint is configuration, not a constant.** `BRIGHT_MLS_TOKEN_ENDPOINT` and
 *     `BRIGHT_MLS_SERVICE_ROOT` are per-environment values on the CronJob, so which feed a run talks
 *     to is inspectable with `kubectl get cronjob -o yaml` and does not require decoding a Secret. A
 *     hard-coded base URL would have looked complete and then needed reworking at the one moment —
 *     production cutover — where getting it wrong is most expensive.
 *  2. **The credential field names are identical in every environment; only the values differ.**
 *     That is what makes GitHub *environment* secrets the enforcement mechanism (see
 *     `infra/k8s/base/secrets/bright-mls.secret.yaml`): per-environment field names would push the
 *     distinction into the deploy action's `yq` substitution, where nothing checks it.
 *  3. **Only the endpoint HOST is ever exposed** (`tokenEndpointHost` / `serviceRootHost`). A run
 *     logs the host so a test-data credential running in production is visible in the first log line
 *     rather than inferred a week later from wrong-looking data. Full URLs are not logged: a token
 *     endpoint's query string is a plausible place for a credential to end up.
 *
 * ## Placeholders are "absent", not "wrong"
 *
 * `infra/k8s/base/secrets/bright-mls.secret.yaml` ships `StrongBase64Password` placeholders, the
 * same convention as `postgres.secret.yaml`. Treating that literal as absent is what lets `local` and
 * `test` — which will never hold Bright credentials — reach a clean, loud "not configured"
 * completion instead of sending a guaranteed-bad credential to Bright and reading a 401 as news.
 */

/**
 * The placeholder committed to Git in every secret template in this repo. A value still equal to it
 * has not been provisioned, and is never sent anywhere.
 */
export const SECRET_PLACEHOLDER = 'StrongBase64Password';

/** Env var names, exported so the manifests and the day-one checklist have one source of truth. */
export const BRIGHT_ENV_VARS = {
  tokenEndpoint: 'BRIGHT_MLS_TOKEN_ENDPOINT',
  serviceRoot: 'BRIGHT_MLS_SERVICE_ROOT',
  clientId: 'BRIGHT_MLS_CLIENT_ID',
  clientSecret: 'BRIGHT_MLS_CLIENT_SECRET',
  feed: 'BRIGHT_MLS_FEED',
  resources: 'BRIGHT_MLS_RESOURCES',
  initialCursor: 'BRIGHT_MLS_INITIAL_CURSOR',
  maxPagesPerRun: 'BRIGHT_MLS_MAX_PAGES_PER_RUN',
  requestsPerSecond: 'BRIGHT_MLS_REQUESTS_PER_SECOND',
  requestsPerMinute: 'BRIGHT_MLS_REQUESTS_PER_MINUTE',
  maxConcurrency: 'BRIGHT_MLS_MAX_CONCURRENCY',
  maxRetries: 'BRIGHT_MLS_MAX_RETRIES',
  fullResync: 'BRIGHT_MLS_FULL_RESYNC',
  cursorMaxAgeHours: 'BRIGHT_MLS_CURSOR_MAX_AGE_HOURS',
} as const;

/** Where a run is pointed. Hosts are the only part that may be logged. */
export interface BrightEndpoint {
  readonly tokenEndpoint: string;
  readonly serviceRoot: string;
  readonly tokenEndpointHost: string;
  readonly serviceRootHost: string;
}

/** Credential material. Never logged, never serialised, never placed on a log record type. */
export interface BrightCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

export type BrightConfig =
  | {
      readonly state: 'configured';
      readonly endpoint: BrightEndpoint;
      readonly credentials: BrightCredentials;
      readonly feed: BrightFeedTier;
      readonly replication: BrightReplicationConfig;
    }
  | {
      /** Endpoint may still be known here — it is configuration, and it is useful to report. */
      readonly state: 'not-configured';
      readonly endpoint: BrightEndpoint | null;
      readonly missing: readonly string[];
    };

/**
 * Raised for a value that is present but unusable — a malformed URL, or a non-HTTPS endpoint. This is
 * a misconfiguration, not an absence, and is deliberately NOT folded into `not-configured`: a typo in
 * a service root would otherwise be reported as "no credentials yet" and sit unnoticed for however
 * long it takes someone to wonder why the feed never arrived.
 */
export class BrightConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrightConfigError';
  }
}

/** Trimmed value, or `null` for unset / blank / still-the-Git-placeholder. */
function present(raw: string | undefined): string | null {
  const value = (raw ?? '').trim();
  if (value.length === 0 || value === SECRET_PLACEHOLDER) {
    return null;
  }
  return value;
}

/**
 * Parses an endpoint URL, requiring HTTPS. HTTP is rejected rather than warned about: this connection
 * carries an OAuth2 client secret, and a downgrade is not something to discover from a packet capture.
 */
function parseEndpointUrl(name: string, raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BrightConfigError(
      `${name} is not a valid absolute URL. It is per-environment configuration on the ` +
        'bright-mls-ingest CronJob — see infra/k8s/base/cronjobs/bright-mls-ingest.cronjob.yaml ' +
        'and the overlay patch for this environment.',
    );
  }
  if (url.protocol !== 'https:') {
    throw new BrightConfigError(
      `${name} must be an https:// URL (got ${url.protocol}//). This request carries an OAuth2 ` +
        'client secret.',
    );
  }
  return url;
}

/**
 * Resolves the endpoint pair, or `null` when neither is set. A half-configured pair is an error:
 * having a service root with no token endpoint means somebody edited one overlay and not the other,
 * and silently ignoring it would point a future run at a feed it cannot authenticate against.
 */
function resolveEndpoint(env: NodeJS.ProcessEnv): BrightEndpoint | null {
  const tokenEndpointRaw = present(env[BRIGHT_ENV_VARS.tokenEndpoint]);
  const serviceRootRaw = present(env[BRIGHT_ENV_VARS.serviceRoot]);

  if (tokenEndpointRaw === null && serviceRootRaw === null) {
    return null;
  }
  if (tokenEndpointRaw === null || serviceRootRaw === null) {
    const missing =
      tokenEndpointRaw === null ? BRIGHT_ENV_VARS.tokenEndpoint : BRIGHT_ENV_VARS.serviceRoot;
    const present_ =
      tokenEndpointRaw === null ? BRIGHT_ENV_VARS.serviceRoot : BRIGHT_ENV_VARS.tokenEndpoint;
    throw new BrightConfigError(
      `${present_} is set but ${missing} is not. The endpoint pair identifies which Bright feed ` +
        'this environment talks to (dev = test/staging, prod = licensed production) and must be ' +
        'set together, or a run could authenticate against one feed and read another.',
    );
  }

  const tokenEndpoint = parseEndpointUrl(BRIGHT_ENV_VARS.tokenEndpoint, tokenEndpointRaw);
  const serviceRoot = parseEndpointUrl(BRIGHT_ENV_VARS.serviceRoot, serviceRootRaw);

  return {
    tokenEndpoint: tokenEndpoint.toString(),
    serviceRoot: serviceRoot.toString(),
    tokenEndpointHost: tokenEndpoint.host,
    serviceRootHost: serviceRoot.host,
  };
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * Feed tier (#92, stakeholder ruling 2026-09-19)
 * ════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * Which Bright feed an environment is allowed to read.
 *
 * The 2026-09-19 ruling supersedes part of the 2026-09-12 one recorded on #117. `local`, `dev` and
 * `test` now all hold real credentials for Bright's **test/staging** feed; `prod` alone reads the
 * licensed production feed. The surviving invariant is that the production credential never leaves
 * production.
 *
 * The old rule enforced that invariant by starving three environments of credentials. That
 * enforcement is gone, so this replaces it: the tier is declared per environment, the base default
 * is `test`, and a `test` declaration **refuses** a production host. The refusal is a failed run,
 * not a warning — a run that reads licensed production inventory into a laptop's database cannot be
 * undone by noticing it afterwards.
 *
 * What this does and does not prevent, stated plainly so nobody over-reads it:
 *
 *  - It prevents any environment except `prod` from reading the production feed, including one whose
 *    endpoint pair was retargeted by mistake and one added later that forgot to patch anything.
 *  - It does **not** prevent a person from pasting a production credential into a non-production
 *    secret. Nothing inside the pod can, because a credential is an opaque string. What happens then
 *    is that the credential is offered to the test token endpoint and rejected, and the first log
 *    line names the host it was offered to.
 */
export type BrightFeedTier = 'test' | 'production';

/**
 * Host labels that mark a non-production feed.
 *
 * Bright's test hosts are `okta.tst.brightmls.com` and `bright-reso.tst.brightmls.com`, so `tst` is
 * the label that matters. The others are here because a matched label must be exact: a substring
 * test would read `latest.brightmls.com` as a test host. Add a label here only with a host in front
 * of you, never speculatively — every entry widens what a `test` environment may talk to.
 */
const NON_PRODUCTION_HOST_LABELS = new Set(['tst', 'test', 'staging', 'stg', 'uat']);

function isNonProductionHost(host: string): boolean {
  const hostname = host.split(':')[0] ?? host;
  return hostname.split('.').some((label) => NON_PRODUCTION_HOST_LABELS.has(label.toLowerCase()));
}

function resolveFeedTier(env: NodeJS.ProcessEnv): BrightFeedTier {
  const raw = (env[BRIGHT_ENV_VARS.feed] ?? '').trim().toLowerCase();
  if (raw.length === 0 || raw === 'test') {
    return 'test';
  }
  if (raw === 'production') {
    return 'production';
  }
  throw new BrightConfigError(
    `${BRIGHT_ENV_VARS.feed} must be "test" or "production", got "${raw}". It declares which Bright ` +
      'feed this environment may read. The base default is "test" and only the prod overlay sets ' +
      '"production".',
  );
}

/**
 * Refuses a production host in a non-production environment.
 *
 * Both hosts are checked, not just the service root. A token endpoint on the production tier means
 * the credential being exchanged is a production credential, whatever the data endpoint says.
 */
function assertFeedTier(endpoint: BrightEndpoint, tier: BrightFeedTier): void {
  if (tier === 'production') {
    return;
  }
  for (const [name, host] of [
    [BRIGHT_ENV_VARS.tokenEndpoint, endpoint.tokenEndpointHost],
    [BRIGHT_ENV_VARS.serviceRoot, endpoint.serviceRootHost],
  ] as const) {
    if (!isNonProductionHost(host)) {
      throw new BrightConfigError(
        `${name} points at ${host}, which is not a recognised test-feed host, but ` +
          `${BRIGHT_ENV_VARS.feed} declares this environment as "test". Only the prod overlay may ` +
          'set the production tier (stakeholder ruling 2026-09-19). If this host really is a test ' +
          'feed, add its label to NON_PRODUCTION_HOST_LABELS in config.ts with the host in the ' +
          'commit message.',
      );
    }
  }
}

/**
 * Resolves the job's configuration from the environment.
 *
 * Returns `not-configured` — never throws — when values are simply absent, because that is the
 * expected steady state for `local` and `test` and the expected state everywhere until #117
 * provisions credentials. Throws `BrightConfigError` only when a value is present and unusable.
 */
export function resolveBrightConfig(env: NodeJS.ProcessEnv = process.env): BrightConfig {
  const endpoint = resolveEndpoint(env);
  const clientId = present(env[BRIGHT_ENV_VARS.clientId]);
  const clientSecret = present(env[BRIGHT_ENV_VARS.clientSecret]);
  // Resolved even when the credential is absent, so a bad value fails the run rather than hiding
  // behind "not configured" until the day a credential arrives.
  const feed = resolveFeedTier(env);
  if (endpoint !== null) {
    assertFeedTier(endpoint, feed);
  }

  const missing: string[] = [];
  if (endpoint === null) {
    missing.push(BRIGHT_ENV_VARS.tokenEndpoint, BRIGHT_ENV_VARS.serviceRoot);
  }
  if (clientId === null) {
    missing.push(BRIGHT_ENV_VARS.clientId);
  }
  if (clientSecret === null) {
    missing.push(BRIGHT_ENV_VARS.clientSecret);
  }

  if (endpoint === null || clientId === null || clientSecret === null) {
    return { state: 'not-configured', endpoint, missing };
  }

  return {
    state: 'configured',
    endpoint,
    credentials: { clientId, clientSecret },
    feed,
    replication: resolveReplicationConfig(env),
  };
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * Replication configuration (#92)
 * ════════════════════════════════════════════════════════════════════════════════════════════ */

export interface BrightReplicationConfig {
  /** Entity set names, in the order a run works them. */
  readonly resources: readonly string[];
  /** Where a first pass, or a pass after a full resync, starts. ISO-8601 with a `Z` suffix. */
  readonly initialCursor: string;
  /** Pages per resource per run. A capped run resumes on the next run, because the cursor advances
   * with each page rather than at the end. */
  readonly maxPagesPerRun: number;
  readonly requestsPerSecond: number;
  readonly requestsPerMinute: number;
  readonly maxConcurrency: number;
  readonly maxRetries: number;
  /** Clears every cursor before the run. The mode ships; whether the licence permits it is #33. */
  readonly fullResync: boolean;
  /** A cursor older than this is reported as stalled on the run record. */
  readonly cursorMaxAgeHours: number;
}

/**
 * Defaults.
 *
 * The three rate numbers are **placeholders, not measurements**. Bright sends no rate-limit header
 * and the contractual ceiling is not in the API, so the only honest default is a slow one. #33
 * records the real limits when the agreement is read. Do not raise these because a backfill feels
 * slow: a capped run resumes on the next schedule, and a ban does not.
 */
export const DEFAULT_REPLICATION: BrightReplicationConfig = {
  resources: ['BrightProperties'],
  initialCursor: '1970-01-01T00:00:00.000Z',
  maxPagesPerRun: 50,
  requestsPerSecond: 2,
  requestsPerMinute: 60,
  maxConcurrency: 1,
  maxRetries: 5,
  fullResync: false,
  cursorMaxAgeHours: 48,
};

function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = present(env[name]);
  if (raw === null) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new BrightConfigError(`${name} must be a positive integer, got "${raw}".`);
  }
  return value;
}

export function resolveReplicationConfig(
  env: NodeJS.ProcessEnv = process.env,
): BrightReplicationConfig {
  const resourcesRaw = present(env[BRIGHT_ENV_VARS.resources]);
  const resources =
    resourcesRaw === null
      ? DEFAULT_REPLICATION.resources
      : resourcesRaw
          .split(',')
          .map((name) => name.trim())
          .filter((name) => name.length > 0);
  if (resources.length === 0) {
    throw new BrightConfigError(
      `${BRIGHT_ENV_VARS.resources} is set but names no resource. Unset it to replicate the ` +
        `default (${DEFAULT_REPLICATION.resources.join(', ')}).`,
    );
  }

  const cursorRaw = present(env[BRIGHT_ENV_VARS.initialCursor]);
  let initialCursor = DEFAULT_REPLICATION.initialCursor;
  if (cursorRaw !== null) {
    const parsed = new Date(cursorRaw);
    if (Number.isNaN(parsed.getTime())) {
      throw new BrightConfigError(
        `${BRIGHT_ENV_VARS.initialCursor} is not a valid ISO-8601 instant, got "${cursorRaw}". It ` +
          'bounds the first query, and an unbounded ordered query against Bright never returns.',
      );
    }
    initialCursor = parsed.toISOString();
  }

  return {
    resources,
    initialCursor,
    maxPagesPerRun: positiveInt(
      env,
      BRIGHT_ENV_VARS.maxPagesPerRun,
      DEFAULT_REPLICATION.maxPagesPerRun,
    ),
    requestsPerSecond: positiveInt(
      env,
      BRIGHT_ENV_VARS.requestsPerSecond,
      DEFAULT_REPLICATION.requestsPerSecond,
    ),
    requestsPerMinute: positiveInt(
      env,
      BRIGHT_ENV_VARS.requestsPerMinute,
      DEFAULT_REPLICATION.requestsPerMinute,
    ),
    maxConcurrency: positiveInt(
      env,
      BRIGHT_ENV_VARS.maxConcurrency,
      DEFAULT_REPLICATION.maxConcurrency,
    ),
    // Zero retries is a legitimate choice, so this one is not `positiveInt`.
    maxRetries: (() => {
      const raw = present(env[BRIGHT_ENV_VARS.maxRetries]);
      if (raw === null) {
        return DEFAULT_REPLICATION.maxRetries;
      }
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 0) {
        throw new BrightConfigError(
          `${BRIGHT_ENV_VARS.maxRetries} must be a non-negative integer, got "${raw}".`,
        );
      }
      return value;
    })(),
    fullResync: present(env[BRIGHT_ENV_VARS.fullResync]) === '1',
    cursorMaxAgeHours: positiveInt(
      env,
      BRIGHT_ENV_VARS.cursorMaxAgeHours,
      DEFAULT_REPLICATION.cursorMaxAgeHours,
    ),
  };
}
