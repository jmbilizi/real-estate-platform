/**
 * Configuration and credential resolution for the Bright MLS ingestion job (#91).
 *
 * This module answers one question — **which feed are we pointed at, and do we hold a credential for
 * it?** — and deliberately answers nothing else. There is no sync logic here and none anywhere else
 * in `src/jobs/bright-ingest/`; incremental replication is #92 and mapping into the consumer schema
 * is #93. What exists today is the vehicle those two drop into.
 *
 * ## Which feed am I talking to? (stakeholder ruling 2026-09-19, superseding 2026-09-12)
 *
 * `local`, `dev` and `test` authenticate against Bright's **test/staging** feed with the real test
 * credentials; `prod` authenticates against the **licensed production** feed. This is the same
 * separation as the ruling it replaces, with a different default — that one protected the production
 * credential by starving three environments, this one protects it by binding three environments to
 * the test feed. **The invariant is unchanged: the production credential never leaves production.**
 *
 * Nothing in this module enforces that invariant, and it is worth being explicit about the gap:
 * `resolveBrightConfig` checks that a credential is present and that an endpoint is HTTPS. It does
 * not check that the credential belongs to the feed the endpoint names, because a client id carries
 * no evidence of which tier issued it. #164 is where that check lands.
 *
 * Three consequences are implemented here rather than left to convention:
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
 * same convention as `postgres.secret.yaml`. Treating that literal as absent is what lets an
 * environment that is not wired yet reach a clean, loud "not configured" completion instead of
 * sending a guaranteed-bad credential to Bright and reading a 401 as news. That is a rollout state,
 * not a permanent one — `local` and `test` are wired by #176 — and the handling is the same either
 * way, which is the point of keying it on the value rather than on the environment.
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

/**
 * Resolves the job's configuration from the environment.
 *
 * Returns `not-configured` — never throws — when values are simply absent, because an environment
 * that is not wired yet is a normal rollout state rather than a fault. Throws `BrightConfigError`
 * only when a value is present and unusable.
 */
export function resolveBrightConfig(env: NodeJS.ProcessEnv = process.env): BrightConfig {
  const endpoint = resolveEndpoint(env);
  const clientId = present(env[BRIGHT_ENV_VARS.clientId]);
  const clientSecret = present(env[BRIGHT_ENV_VARS.clientSecret]);

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

  return { state: 'configured', endpoint, credentials: { clientId, clientSecret } };
}
