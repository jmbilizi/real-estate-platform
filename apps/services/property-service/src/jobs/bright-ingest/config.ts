/**
 * Configuration and credential resolution for the Bright MLS ingestion job.
 *
 * This module answers one question — **which feed are we pointed at, and do we hold a credential for
 * it?** — and deliberately answers nothing else. Replication is `replicate.ts`; mapping into the
 * consumer schema is #93.
 *
 * ## Which feed am I talking to? (stakeholder ruling 2026-09-19, superseding 2026-09-12)
 *
 * `local`, `dev` and `test` authenticate against Bright's **test/staging** feed with the real test
 * credentials; `prod` authenticates against the **licensed production** feed. This is the same
 * separation as the ruling it replaces, with a different default — that one protected the production
 * credential by starving three environments, this one protects it by binding three environments to
 * the test feed. **The invariant is unchanged: the production credential never leaves production.**
 *
 * `BRIGHT_MLS_ENV` (#246, replacing `BRIGHT_MLS_FEED`) is the single selector for both halves of
 * that invariant. It picks the credential pair (`resolveCredentials`) AND the allowed host labels
 * (`assertFeedTier`). A production credential filed under a `test` environment's `BRIGHT_MLS_PROD_*`
 * key is never read there — the resolver only reads the `TEST` pair — so the misfile is inert
 * rather than merely rejected by Bright's own tenant separation. This delivers most of #164: naming
 * the key by tier is a check a reader can find, where a bare credential value carries no evidence
 * of which tier issued it.
 *
 * Bright itself closes the remaining gap: measured 2026-09-19, a test credential presented to the
 * production token endpoint is refused with HTTP 400, because the two tiers are separate Okta
 * tenants. So a misfiled credential is rejected rather than silently working, even before #246.
 *
 * Four consequences are implemented here rather than left to convention:
 *
 *  1. **The endpoint is configuration, not a constant.** `BRIGHT_MLS_TOKEN_ENDPOINT` and
 *     `BRIGHT_MLS_SERVICE_ROOT` are per-environment values on the CronJob, so which feed a run talks
 *     to is inspectable with `kubectl get cronjob -o yaml` and does not require decoding a Secret. A
 *     hard-coded base URL would have looked complete and then needed reworking at the one moment —
 *     production cutover — where getting it wrong is most expensive.
 *  2. **The credential keys are tier-suffixed; only the values differ across environments.** That is
 *     what makes GitHub *environment* secrets the enforcement mechanism (see
 *     `infra/k8s/base/secrets/bright-mls.secret.yaml`): a value filed under the wrong tier's key
 *     name is a manifest-visible mistake, not a silently accepted one.
 *  3. **Only the endpoint HOST is ever exposed** (`tokenEndpointHost` / `serviceRootHost`). A run
 *     logs the host so a test-data credential running in production is visible in the first log line
 *     rather than inferred a week later from wrong-looking data. Full URLs are not logged: a token
 *     endpoint's query string is a plausible place for a credential to end up.
 *  4. **The feed tier is declared, and a mismatched tier refuses the host in both directions.** See
 *     `BrightFeedTier` below. `test` refuses a production host; `production` refuses a recognised
 *     non-production host (#246 — the old rule only checked the first direction).
 *
 * ## Placeholders are "absent", not "wrong"
 *
 * `infra/k8s/base/secrets/bright-mls.secret.yaml` ships `StrongBase64Password` placeholders, the
 * same convention as `postgres.secret.yaml`. Treating that literal as absent is what lets an
 * environment that is not wired yet reach a clean, loud "not configured" completion instead of
 * sending a guaranteed-bad credential to Bright and reading a 401 as news. That is a rollout state,
 * not a permanent one — every overlay carries an endpoint pair since #176 — and the handling is the
 * same either way, which is the point of keying it on the value rather than on the environment.
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
  // Pre-#246 unsuffixed pair. Kept for one release as a migration fallback — see
  // resolveCredentials(). Delete once every environment is provisioned on the tier-suffixed keys.
  clientId: 'BRIGHT_MLS_CLIENT_ID',
  clientSecret: 'BRIGHT_MLS_CLIENT_SECRET',
  // Tier-suffixed pairs (#246). The resolved tier picks one pair and never reads the other.
  testClientId: 'BRIGHT_MLS_TEST_CLIENT_ID',
  testClientSecret: 'BRIGHT_MLS_TEST_CLIENT_SECRET',
  prodClientId: 'BRIGHT_MLS_PROD_CLIENT_ID',
  prodClientSecret: 'BRIGHT_MLS_PROD_CLIENT_SECRET',
  // Current tier selector (#246), replacing `feed` below as the declaration a reader should trust.
  env: 'BRIGHT_MLS_ENV',
  // Pre-#246 name for the same declaration. Kept for one release as a migration fallback — see
  // resolveFeedTier(). Delete once every overlay is confirmed on BRIGHT_MLS_ENV.
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
        'this environment talks to (prod = licensed production, every other environment = ' +
        'test/staging) and must be ' +
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
 * The tier is declared per environment (`BRIGHT_MLS_ENV`, #246), the base default is `test`, and
 * the host check runs in both directions: `test` refuses a production host, `production` refuses a
 * recognised non-production host. The refusal is a failed run, not a warning — a run that reads
 * licensed production inventory into a laptop's database cannot be undone by noticing it afterwards.
 *
 * What this does and does not prevent, stated plainly so nobody over-reads it:
 *
 *  - It prevents any environment except `prod` from reading the production feed, including one whose
 *    endpoint pair was retargeted by mistake and one added later that forgot to patch anything.
 *  - Since #246, it also prevents a production credential pasted into a non-production secret from
 *    reaching Bright at all: `resolveCredentials` reads only the resolved tier's key pair, so a
 *    value filed under the other tier's key is never read, let alone transmitted. Before #246 the
 *    same misfile depended on Bright's own tenant separation to reject it at the token endpoint.
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

/** Trimmed, lowercased value, or `null` when unset or blank. */
function normalizedOrNull(raw: string | undefined): string | null {
  const value = (raw ?? '').trim().toLowerCase();
  return value.length === 0 ? null : value;
}

/**
 * Resolves the feed tier. `BRIGHT_MLS_ENV` (#246) is the current declaration; `BRIGHT_MLS_FEED` is
 * the pre-#246 name, read only as a fallback and kept for one release. Reading both and refusing a
 * disagreement — rather than letting one silently win — is what stops a half-migrated overlay from
 * declaring two different tiers and having nobody notice which one applied.
 */
function resolveFeedTier(env: NodeJS.ProcessEnv): BrightFeedTier {
  const envValue = normalizedOrNull(env[BRIGHT_ENV_VARS.env]);
  const feedValue = normalizedOrNull(env[BRIGHT_ENV_VARS.feed]);

  if (envValue !== null && feedValue !== null && envValue !== feedValue) {
    throw new BrightConfigError(
      `${BRIGHT_ENV_VARS.env}="${envValue}" and ${BRIGHT_ENV_VARS.feed}="${feedValue}" disagree. ` +
        `${BRIGHT_ENV_VARS.env} is the current declaration; ${BRIGHT_ENV_VARS.feed} is kept for one ` +
        'release as a migration fallback and must name the same tier while both are set.',
    );
  }

  const raw = envValue ?? feedValue;
  const source = envValue !== null ? BRIGHT_ENV_VARS.env : BRIGHT_ENV_VARS.feed;

  if (raw === null || raw === 'test') {
    return 'test';
  }
  if (raw === 'production') {
    return 'production';
  }
  throw new BrightConfigError(
    `${source} must be "test" or "production", got "${raw}". It declares which Bright feed this ` +
      'environment may read. The base default is "test" and only the prod overlay sets ' +
      '"production".',
  );
}

/**
 * Refuses a tier/host mismatch in either direction (#246).
 *
 * Both hosts are checked, not just the service root. A token endpoint on the wrong tier means the
 * credential being exchanged is for the wrong tier, whatever the data endpoint says.
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
          `${BRIGHT_ENV_VARS.env} declares this environment as "test". Set ` +
          `${BRIGHT_ENV_VARS.env}="production" if this environment is meant to read the licensed ` +
          'production feed. If this host really is a test feed, add its label to ' +
          'NON_PRODUCTION_HOST_LABELS in config.ts with the host in the commit message.',
      );
    }
    if (tier === 'production' && nonProductionHost) {
      throw new BrightConfigError(
        `${name} points at ${host}, which is a recognised test-feed host, but ` +
          `${BRIGHT_ENV_VARS.env} declares this environment as "production". A production ` +
          'declaration must point at the licensed production feed, never a test host.',
      );
    }
  }
}

/** One resolved credential pair, plus the key names it was read from (never a value). */
interface ResolvedCredentials {
  readonly clientId: string | null;
  readonly clientSecret: string | null;
  readonly clientIdVar: string;
  readonly clientSecretVar: string;
}

/**
 * Resolves the credential pair for the given tier.
 *
 * The tier-suffixed pair (#246) is read first and is the only pair ever read for a `configured`
 * result once it is fully set — the other tier's pair, and the legacy pair, are never consulted.
 * A half-set tier-suffixed pair is a provisioning mistake, not an absence, so it throws rather than
 * silently falling through to the legacy pair. Only when NEITHER tier-suffixed value is present
 * does resolution fall back to the pre-#246 unsuffixed pair, kept for one release.
 */
function resolveCredentials(env: NodeJS.ProcessEnv, tier: BrightFeedTier): ResolvedCredentials {
  const clientIdVar = tier === 'test' ? BRIGHT_ENV_VARS.testClientId : BRIGHT_ENV_VARS.prodClientId;
  const clientSecretVar =
    tier === 'test' ? BRIGHT_ENV_VARS.testClientSecret : BRIGHT_ENV_VARS.prodClientSecret;

  const suffixedId = present(env[clientIdVar]);
  const suffixedSecret = present(env[clientSecretVar]);

  if (suffixedId !== null || suffixedSecret !== null) {
    if (suffixedId === null || suffixedSecret === null) {
      const missingVar = suffixedId === null ? clientIdVar : clientSecretVar;
      const presentVar = suffixedId === null ? clientSecretVar : clientIdVar;
      throw new BrightConfigError(
        `${presentVar} is set but ${missingVar} is not. The tier-suffixed pair must be set ` +
          'together, or a run could authenticate with half a credential.',
      );
    }
    return { clientId: suffixedId, clientSecret: suffixedSecret, clientIdVar, clientSecretVar };
  }

  const legacyId = present(env[BRIGHT_ENV_VARS.clientId]);
  const legacySecret = present(env[BRIGHT_ENV_VARS.clientSecret]);
  return {
    clientId: legacyId,
    clientSecret: legacySecret,
    clientIdVar: BRIGHT_ENV_VARS.clientId,
    clientSecretVar: BRIGHT_ENV_VARS.clientSecret,
  };
}

/**
 * Resolves the job's configuration from the environment.
 *
 * Returns `not-configured` — never throws — when values are simply absent, because an environment
 * that is not wired yet is a normal rollout state rather than a fault. Throws `BrightConfigError`
 * only when a value is present and unusable.
 */
export function resolveBrightConfig(env: NodeJS.ProcessEnv = process.env): BrightConfig {
  const endpoint = resolveEndpoint(env);
  // Resolved even when the credential is absent, so a bad value fails the run rather than hiding
  // behind "not configured" until the day a credential arrives.
  const feed = resolveFeedTier(env);
  const { clientId, clientSecret, clientIdVar, clientSecretVar } = resolveCredentials(env, feed);
  if (endpoint !== null) {
    assertFeedTier(endpoint, feed);
  }

  const missing: string[] = [];
  if (endpoint === null) {
    missing.push(BRIGHT_ENV_VARS.tokenEndpoint, BRIGHT_ENV_VARS.serviceRoot);
  }
  if (clientId === null) {
    missing.push(clientIdVar);
  }
  if (clientSecret === null) {
    missing.push(clientSecretVar);
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
    fullResync: resolveFullResync(env),
    cursorMaxAgeHours: positiveInt(
      env,
      BRIGHT_ENV_VARS.cursorMaxAgeHours,
      DEFAULT_REPLICATION.cursorMaxAgeHours,
    ),
  };
}
