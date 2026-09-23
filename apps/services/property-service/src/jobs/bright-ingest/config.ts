/**
 * Configuration and credential resolution for the Bright MLS ingestion job.
 *
 * This module answers one question — **which feed are we pointed at, and do we hold a credential for
 * it?** — and deliberately answers nothing else. Replication is `replicate.ts`; mapping into the
 * consumer schema is `../bright-map/`.
 *
 * ## Which feed am I talking to?
 *
 * Any environment may read either Bright tier. The lower environments are gated and not public, so
 * the tier is whatever the provisioned credential belongs to. Three keys in `bright-mls-secret`:
 *
 *  - `BRIGHT_MLS_ENV` — `test` or `production`. It states which tier `BRIGHT_MLS_CLIENT_ID` /
 *    `BRIGHT_MLS_CLIENT_SECRET` belong to, and the job trusts it exactly. Nothing is inferred.
 *  - `BRIGHT_MLS_CLIENT_ID` / `BRIGHT_MLS_CLIENT_SECRET` — the OAuth2 client credential.
 *
 * The endpoints follow the tier (`BRIGHT_FEED_ENDPOINTS`). `BRIGHT_MLS_TOKEN_ENDPOINT` /
 * `BRIGHT_MLS_SERVICE_ROOT` may override them (the tests use this). An override must match the tier
 * (`assertFeedTier`): the two tiers are separate Okta tenants, so a credential sent to the other
 * tier's host can only fail.
 *
 * Only endpoint HOSTS are ever exposed (`tokenEndpointHost` / `serviceRootHost`), so the first log
 * line of a run names the feed. Full URLs are not logged: a token endpoint's query string is a
 * plausible place for a credential to end up.
 *
 * ## Placeholders are "absent", not "wrong"
 *
 * `infra/k8s/base/secrets/bright-mls.secret.yaml` ships `StrongBase64Password` placeholders, the
 * same convention as `postgres.secret.yaml`. Treating that literal as absent is what lets an
 * environment that is not wired yet reach a clean, loud "not configured" completion instead of
 * sending a guaranteed-bad credential to Bright and reading a 401 as news.
 */

import { resolveCrawlResource } from './resources';

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
  // The tier the credential belongs to: `test` or `production`. See the module header.
  env: 'BRIGHT_MLS_ENV',
  resources: 'BRIGHT_MLS_RESOURCES',
  initialCursor: 'BRIGHT_MLS_INITIAL_CURSOR',
  maxPagesPerRun: 'BRIGHT_MLS_MAX_PAGES_PER_RUN',
  // The full crawl (#191). Off by default — an environment opts in by naming a resource.
  crawlResources: 'BRIGHT_MLS_CRAWL_RESOURCES',
  crawlMaxPagesPerRun: 'BRIGHT_MLS_CRAWL_MAX_PAGES_PER_RUN',
  requestsPerSecond: 'BRIGHT_MLS_REQUESTS_PER_SECOND',
  requestsPerMinute: 'BRIGHT_MLS_REQUESTS_PER_MINUTE',
  maxConcurrency: 'BRIGHT_MLS_MAX_CONCURRENCY',
  maxRetries: 'BRIGHT_MLS_MAX_RETRIES',
  fullResync: 'BRIGHT_MLS_FULL_RESYNC',
  cursorMaxAgeHours: 'BRIGHT_MLS_CURSOR_MAX_AGE_HOURS',
  requestTimeoutMs: 'BRIGHT_MLS_REQUEST_TIMEOUT_MS',
  pageSize: 'BRIGHT_MLS_PAGE_SIZE',
  replicationBudgetMs: 'BRIGHT_MLS_REPLICATION_BUDGET_MS',
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
      `${name} is not a valid absolute URL. Leave it empty to use the verified endpoint for the ` +
        'resolved tier, or see infra/k8s/base/cronjobs/bright-mls-ingest.cronjob.yaml.',
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

function toEndpoint(tokenEndpointRaw: string, serviceRootRaw: string): BrightEndpoint {
  const tokenEndpoint = parseEndpointUrl(BRIGHT_ENV_VARS.tokenEndpoint, tokenEndpointRaw);
  const serviceRoot = parseEndpointUrl(BRIGHT_ENV_VARS.serviceRoot, serviceRootRaw);
  return {
    tokenEndpoint: tokenEndpoint.toString(),
    serviceRoot: serviceRoot.toString(),
    tokenEndpointHost: tokenEndpoint.host,
    serviceRootHost: serviceRoot.host,
  };
}

/**
 * Resolves an explicit endpoint pair, or `null` when neither is set. A half-configured pair is an
 * error: a service root with no token endpoint means somebody edited one value and not the other,
 * and a run could authenticate against one feed and read another.
 */
function resolveExplicitEndpoint(env: NodeJS.ProcessEnv): BrightEndpoint | null {
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
      `${present_} is set but ${missing} is not. Set both, or leave both empty to use the ` +
        'verified endpoint pair for the resolved tier.',
    );
  }

  return toEndpoint(tokenEndpointRaw, serviceRootRaw);
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * Feed tier
 * ════════════════════════════════════════════════════════════════════════════════════════════ */

/** Which Bright feed a run reads. See the module header for how it is resolved. */
export type BrightFeedTier = 'test' | 'production';

/**
 * The verified endpoint pair per tier (#163). The test pair was credential-verified on 2026-09-18.
 * The production token path follows the test `default` authorization server; if the first
 * production token call returns 404 or `invalid_client`, re-read
 * `https://okta.brightmls.com/oauth2/default/.well-known/openid-configuration` before suspecting the
 * credential. Never substitute `brightmls.test.okta.com`: Okta's `*.okta.com` wildcard cannot match
 * a three-label name, so TLS fails permanently.
 */
export const BRIGHT_FEED_ENDPOINTS: Readonly<
  Record<BrightFeedTier, { readonly tokenEndpoint: string; readonly serviceRoot: string }>
> = Object.freeze({
  test: Object.freeze({
    tokenEndpoint: 'https://okta.tst.brightmls.com/oauth2/default/v1/token',
    serviceRoot: 'https://bright-reso.tst.brightmls.com/RESO/OData/bright',
  }),
  production: Object.freeze({
    tokenEndpoint: 'https://okta.brightmls.com/oauth2/default/v1/token',
    serviceRoot: 'https://bright-reso.brightmls.com/RESO/OData/bright',
  }),
});

/**
 * Host labels that mark a non-production feed.
 *
 * Bright's test hosts are `okta.tst.brightmls.com` and `bright-reso.tst.brightmls.com`, so `tst` is
 * the label that matters. A matched label must be exact: a substring test would read
 * `latest.brightmls.com` as a test host.
 */
const NON_PRODUCTION_HOST_LABELS = new Set(['tst', 'test', 'staging', 'stg', 'uat']);

function isNonProductionHost(host: string): boolean {
  const hostname = host.split(':')[0] ?? host;
  return hostname.split('.').some((label) => NON_PRODUCTION_HOST_LABELS.has(label.toLowerCase()));
}

/**
 * Reads the declared tier. `null` when unset, blank or the Git placeholder, which reports as
 * not configured. Any value other than `test` or `production` is a misconfiguration.
 */
function resolveFeedTier(env: NodeJS.ProcessEnv): BrightFeedTier | null {
  const raw = present(env[BRIGHT_ENV_VARS.env]);
  if (raw === null) {
    return null;
  }
  const value = raw.toLowerCase();
  if (value === 'test' || value === 'production') {
    return value;
  }
  throw new BrightConfigError(
    `${BRIGHT_ENV_VARS.env} must be "test" or "production", got "${raw}". It states which Bright ` +
      `tier ${BRIGHT_ENV_VARS.clientId} / ${BRIGHT_ENV_VARS.clientSecret} belong to.`,
  );
}

/**
 * Refuses an endpoint override on the other tier, in either direction. Both hosts are checked: a
 * token endpoint on the wrong tier means the credential is exchanged with the wrong Okta tenant.
 */
function assertFeedTier(endpoint: BrightEndpoint, tier: BrightFeedTier): void {
  for (const [name, host] of [
    [BRIGHT_ENV_VARS.tokenEndpoint, endpoint.tokenEndpointHost],
    [BRIGHT_ENV_VARS.serviceRoot, endpoint.serviceRootHost],
  ] as const) {
    const nonProductionHost = isNonProductionHost(host);
    if (tier === 'test' && !nonProductionHost) {
      throw new BrightConfigError(
        `${name} points at ${host}, which is not a recognised test-feed host, but ` +
          `${BRIGHT_ENV_VARS.env} is "test". Leave the endpoint empty to use the tier default.`,
      );
    }
    if (tier === 'production' && nonProductionHost) {
      throw new BrightConfigError(
        `${name} points at ${host}, which is a recognised test-feed host, but ` +
          `${BRIGHT_ENV_VARS.env} is "production". Leave the endpoint empty to use the tier default.`,
      );
    }
  }
}

/**
 * Resolves the job's configuration from the environment.
 *
 * Returns `not-configured` — never throws — when a value is simply absent, because an environment
 * that is not wired yet is a normal rollout state rather than a fault. Throws `BrightConfigError`
 * only when a value is present and unusable.
 */
export function resolveBrightConfig(env: NodeJS.ProcessEnv = process.env): BrightConfig {
  const feed = resolveFeedTier(env);
  const explicitEndpoint = resolveExplicitEndpoint(env);
  if (explicitEndpoint !== null && feed !== null) {
    assertFeedTier(explicitEndpoint, feed);
  }
  const endpoint =
    explicitEndpoint ??
    (feed === null
      ? null
      : toEndpoint(
          BRIGHT_FEED_ENDPOINTS[feed].tokenEndpoint,
          BRIGHT_FEED_ENDPOINTS[feed].serviceRoot,
        ));
  const clientId = present(env[BRIGHT_ENV_VARS.clientId]);
  const clientSecret = present(env[BRIGHT_ENV_VARS.clientSecret]);

  const missing: string[] = [];
  if (feed === null) {
    missing.push(BRIGHT_ENV_VARS.env);
  }
  if (clientId === null) {
    missing.push(BRIGHT_ENV_VARS.clientId);
  }
  if (clientSecret === null) {
    missing.push(BRIGHT_ENV_VARS.clientSecret);
  }

  if (feed === null || endpoint === null || clientId === null || clientSecret === null) {
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
  /** Entity set names the full crawl (#191) targets. Empty means the crawl does not run. */
  readonly crawlResources: readonly string[];
  /** Pages per resource per crawl run. A capped run stores its @odata.nextLink and resumes next run. */
  readonly crawlMaxPagesPerRun: number;
  readonly requestsPerSecond: number;
  readonly requestsPerMinute: number;
  readonly maxConcurrency: number;
  readonly maxRetries: number;
  /** Clears every cursor before the run. The mode ships; whether the licence permits it is #33. */
  readonly fullResync: boolean;
  /** A cursor older than this is reported as stalled on the run record. */
  readonly cursorMaxAgeHours: number;
  /**
   * Per-request timeout. A 1000-record production `BrightProperties` page of 931 fields took longer
   * than the 30-second client default on 2026-09-22, so the default here is 120 seconds.
   */
  readonly requestTimeoutMs: number;
  /**
   * Records per request (`$top`), 1–1000. `null` = Bright's own 1000-record pages via nextLink.
   * See "Explicit page size" in `replicate.ts`.
   */
  readonly pageSize: number | null;
  /**
   * Wall-clock budget for the incremental pass. Past it no further page is requested, so the run
   * always reaches mapping inside the CronJob deadline. The cursor resumes next run.
   */
  readonly replicationBudgetMs: number;
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
  crawlResources: [],
  crawlMaxPagesPerRun: 50,
  requestsPerSecond: 2,
  requestsPerMinute: 60,
  maxConcurrency: 1,
  maxRetries: 5,
  fullResync: false,
  cursorMaxAgeHours: 48,
  requestTimeoutMs: 120_000,
  pageSize: null,
  replicationBudgetMs: 300_000,
};

/**
 * Reads the full-resync switch.
 *
 * `'1'` is the repo's convention for a boolean environment flag, matching
 * `PROPERTY_SERVICE_SEED_ON_START`. An unrecognised value THROWS rather than reading as false: an
 * operator who sets `BRIGHT_MLS_FULL_RESYNC=true` to force a resync would otherwise get an ordinary
 * incremental run, with no cursor reset and nothing in the log saying the flag was ignored.
 */
function resolveFullResync(env: NodeJS.ProcessEnv): boolean {
  const raw = present(env[BRIGHT_ENV_VARS.fullResync]);
  if (raw === null || raw === '0') {
    return false;
  }
  if (raw === '1') {
    return true;
  }
  throw new BrightConfigError(
    `${BRIGHT_ENV_VARS.fullResync} must be "1" to request a full resync, "0" or unset otherwise. ` +
      `Got "${raw}". It is rejected rather than read as false, because a resync that silently did ` +
      'not happen is the worst of the three outcomes.',
  );
}

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

/**
 * Reads `BRIGHT_MLS_CRAWL_RESOURCES`.
 *
 * Unset means the crawl does not run — `DEFAULT_REPLICATION.crawlResources` is empty, unlike the
 * incremental `resources`, which always names at least `BrightProperties`. An unknown name, or a
 * known resource `resolveCrawlResource` refuses, throws immediately rather than failing the CronJob
 * on its first scheduled run.
 */
function resolveCrawlResources(env: NodeJS.ProcessEnv): readonly string[] {
  const raw = present(env[BRIGHT_ENV_VARS.crawlResources]);
  if (raw === null) {
    return DEFAULT_REPLICATION.crawlResources;
  }
  const names = raw
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  for (const name of names) {
    try {
      resolveCrawlResource(name);
    } catch (error) {
      throw new BrightConfigError(
        `${BRIGHT_ENV_VARS.crawlResources} names "${name}", which the full-crawl path refuses: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return names;
}

function nonNegativeInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = present(env[name]);
  if (raw === null) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new BrightConfigError(`${name} must be a non-negative integer, got "${raw}".`);
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
    crawlResources: resolveCrawlResources(env),
    crawlMaxPagesPerRun: positiveInt(
      env,
      BRIGHT_ENV_VARS.crawlMaxPagesPerRun,
      DEFAULT_REPLICATION.crawlMaxPagesPerRun,
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
    maxRetries: nonNegativeInt(env, BRIGHT_ENV_VARS.maxRetries, DEFAULT_REPLICATION.maxRetries),
    fullResync: resolveFullResync(env),
    pageSize: (() => {
      if (present(env[BRIGHT_ENV_VARS.pageSize]) === null) {
        return DEFAULT_REPLICATION.pageSize;
      }
      const value = positiveInt(env, BRIGHT_ENV_VARS.pageSize, 1);
      if (value > 1000) {
        throw new BrightConfigError(`${BRIGHT_ENV_VARS.pageSize} must be 1000 or less.`);
      }
      return value;
    })(),
    replicationBudgetMs: positiveInt(
      env,
      BRIGHT_ENV_VARS.replicationBudgetMs,
      DEFAULT_REPLICATION.replicationBudgetMs,
    ),
    requestTimeoutMs: positiveInt(
      env,
      BRIGHT_ENV_VARS.requestTimeoutMs,
      DEFAULT_REPLICATION.requestTimeoutMs,
    ),
    cursorMaxAgeHours: positiveInt(
      env,
      BRIGHT_ENV_VARS.cursorMaxAgeHours,
      DEFAULT_REPLICATION.cursorMaxAgeHours,
    ),
  };
}
