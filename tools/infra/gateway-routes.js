#!/usr/bin/env node

'use strict';

/**
 * Gateway route ↔ deploy-control cross-check — the guard for the *inverse* of the
 * unregistered-workload problem that `deploy-scope.js` catches.
 *
 * `deploy-scope.js` answers "will this workload deploy without permission?". This file
 * answers the opposite question: **"does the gateway advertise something that will never
 * deploy here?"** Both failures are silent in the manifests; only this one is silent all
 * the way into production, because the gateway starts perfectly happily and only fails
 * when a human opens a browser.
 *
 * ── The failure this exists to prevent (#22 / #71) ─────────────────────────────────────
 *
 * `apps/api-gateway/Startup.cs` merges every `Configuration/Routes/*.json` at startup, so
 * a route file ships its `Routes` *and* its `SwaggerEndPoints` entry regardless of whether
 * `infra/deploy-control.yaml` will deploy that service to the target environment. When
 * `property-service` sat gated off in dev, the gateway still advertised
 * `http://property-service-svc:3002/openapi.json`; SwaggerForOcelot could not fetch it, so
 * `/swagger/docs/v1/Property` returned **500** — taking out the whole aggregation endpoint,
 * not just that one document — and `/property/listings` returned **502**. Nothing in CI,
 * the manifests, or the gateway logs said a word.
 *
 * ── The mapping rule ───────────────────────────────────────────────────────────────────
 *
 * A route's downstream host (`property-service-svc`) is resolved to a deploy-control key
 * (`property-service`) **through the rendered manifests**, never by string surgery on the
 * name:
 *
 *     downstream host → Service.metadata.name → that Service's identity label → key
 *
 * The identity label is the same one `deploy-scope.js` enforces (`app`, then
 * `app.kubernetes.io/name`), so the two files cannot disagree about who owns what. Every
 * step is allowed to fail loudly: a host no rendered Service provides, a Service carrying
 * no identity label that names a registered key, or a port the Service does not expose are
 * each errors in their own right. A rename therefore breaks the check instead of slipping
 * through it.
 *
 * ── The two switches that un-advertise a route file ────────────────────────────────────
 *
 * Both are policed here, by the same rule, because they cause the same defect:
 *
 *   1. `Active: false` in the route file — GLOBAL. "Advertised in no environment, ever."
 *   2. `GATEWAY_DISABLED_SERVICES` on the api-gateway Deployment (comma-separated
 *      `ServiceName` values, honoured by `JsonMerger`) — PER-ENVIRONMENT.
 *
 * Either one used on a service that deploy-control still deploys produces the mirror image
 * of the outage above: the pod runs, nothing routes to it, and its document is missing from
 * the Swagger aggregation. The guard originally covered only (2), and a stakeholder proved
 * the hole by setting `Active: false` on `property-service-routes.json` while
 * property-service was deployable in dev — `hetzner/dev: PASSED`. `Active` is in fact the
 * likelier of the two to be flipped by mistake, because it sits in the route file itself
 * rather than in an overlay.
 *
 * So `Active: false` is judged against EVERY environment (it is a global switch, so a
 * per-environment answer would be the wrong shape, and no single-environment invocation can
 * be allowed to miss it), while `GATEWAY_DISABLED_SERVICES` is judged against the
 * environment under validation. Only one of the two ever reports a given file, so one cause
 * never yields two errors. Using both on one service is itself rejected — as redundant, not
 * as a stale entry, so the message points at the real decision.
 *
 * `GATEWAY_DISABLED_SERVICES` is NOT a fourth hand-maintained registry: this check derives
 * the correct set from `deploy-control.yaml` and requires the declared set to equal it
 * **exactly**, in both directions. Under-suppressing is the outage above; over-suppressing
 * means a service that is running is unreachable through the gateway, which is just as
 * silent.
 *
 * Note that `Active` requires the boolean `true`: `"true"`, `1` and a missing key all read
 * as inactive in `JsonMerger` AND here. The two agree, so a typo produces no divergence to
 * notice — it is caught only because the service stays deployable.
 */

const fs = require('fs');
const path = require('path');

const { IDENTITY_LABELS } = require('./deploy-scope');

const REPO_ROOT = path.resolve(__dirname, '../..');

/** Startup.cs globs this directory; the check must glob it too, never a hardcoded list. */
const ROUTES_DIR = 'apps/api-gateway/Configuration/Routes';

/** Per-environment route suppression, read by JsonMerger via Startup.cs. */
const DISABLED_SERVICES_ENV = 'GATEWAY_DISABLED_SERVICES';

/** The deploy-control key and identity label of the gateway itself. */
const GATEWAY_KEY = 'api-gateway';

const DEFAULT_PORTS = { 'http:': 80, 'https:': 443 };

// ── Route files ─────────────────────────────────────────────────────────────────────────

/**
 * @param {string} file      Base name, used verbatim in failure messages.
 * @param {object} json      Parsed route file.
 * @returns {{file: string, serviceName: string|null, active: boolean, downstreams: object[]}}
 */
function parseRouteFile(file, json) {
  const downstreams = [];

  (json.Routes ?? []).forEach((route, routeIndex) => {
    (route.DownstreamHostAndPorts ?? []).forEach((target, targetIndex) => {
      downstreams.push({
        host: target.Host,
        port: typeof target.Port === 'number' ? target.Port : null,
        origin: `Routes[${routeIndex}].DownstreamHostAndPorts[${targetIndex}]`,
      });
    });
  });

  // The Swagger aggregation URL is the one that actually produced the 500, so it is
  // resolved exactly like a route downstream rather than trusted.
  (json.SwaggerEndPoints ?? []).forEach((endpoint, endpointIndex) => {
    (endpoint.Config ?? []).forEach((config, configIndex) => {
      const origin = `SwaggerEndPoints[${endpointIndex}].Config[${configIndex}].Url`;
      let url;
      try {
        url = new URL(config.Url);
      } catch {
        downstreams.push({ host: null, port: null, origin, raw: config.Url });
        return;
      }
      downstreams.push({
        host: url.hostname,
        port: url.port ? Number(url.port) : (DEFAULT_PORTS[url.protocol] ?? null),
        origin,
      });
    });
  });

  return {
    file,
    serviceName: typeof json.ServiceName === 'string' ? json.ServiceName : null,
    // JsonMerger requires the boolean `true`; a string "true", a 1, or a missing key are all
    // inactive. `activeRaw` is kept so the guard can tell a deliberate `false` apart from a
    // typo and say which it is — the two need very different fixes.
    active: json.Active === true,
    activeRaw: json.Active,
    downstreams,
  };
}

/** Whether the file is inactive by accident rather than by decision. */
function isActiveTypo(routeFile) {
  return routeFile.activeRaw !== undefined && routeFile.activeRaw !== false;
}

/** Why a route file counts as inactive, phrased for whoever has to fix it. */
function describeInactive(routeFile) {
  const raw = routeFile.activeRaw;
  if (raw === false) {
    return 'Active: false';
  }
  if (raw === undefined) {
    return 'no "Active" key';
  }
  return `"Active": ${JSON.stringify(raw)} is a ${typeof raw}, not the boolean true, so it reads as inactive`;
}

/** The fix depends on whether the author meant it. */
function describeInactiveFix(routeFile) {
  if (isActiveTypo(routeFile)) {
    return 'If the service was meant to be advertised, write the boolean "Active": true.';
  }
  return (
    'If it is meant to be advertised somewhere, set "Active": true and suppress the ' +
    `environments that do not deploy it with ${DISABLED_SERVICES_ENV} instead.`
  );
}

/** Glob the route directory the same way Startup.cs does. */
function loadRouteFiles(directory = path.join(REPO_ROOT, ROUTES_DIR)) {
  if (!fs.existsSync(directory)) {
    return [];
  }
  return fs
    .readdirSync(directory)
    .filter((entry) => entry.endsWith('.json'))
    .sort()
    .map((entry) =>
      parseRouteFile(entry, JSON.parse(fs.readFileSync(path.join(directory, entry), 'utf-8'))),
    );
}

// ── Rendered manifests ──────────────────────────────────────────────────────────────────

function servicesByName(documents) {
  const byName = new Map();
  for (const document of documents) {
    if (document?.kind === 'Service' && document.metadata?.name) {
      byName.set(document.metadata.name, document);
    }
  }
  return byName;
}

function gatewayDeployment(documents) {
  return documents.find(
    (document) =>
      document?.kind === 'Deployment' &&
      IDENTITY_LABELS.some((label) => document.metadata?.labels?.[label] === GATEWAY_KEY),
  );
}

/** The `GATEWAY_DISABLED_SERVICES` value declared by the rendered gateway Deployment. */
function declaredDisabledServices(deployment) {
  const containers = deployment?.spec?.template?.spec?.containers ?? [];
  for (const container of containers) {
    const entry = (container.env ?? []).find((variable) => variable.name === DISABLED_SERVICES_ENV);
    if (entry) {
      return String(entry.value ?? '')
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean);
    }
  }
  return [];
}

/** The deploy-control key that owns a rendered Service, or null. */
function ownerKeyOf(serviceDocument, registeredKeys) {
  for (const label of IDENTITY_LABELS) {
    const value = serviceDocument.metadata?.labels?.[label];
    if (typeof value === 'string' && registeredKeys.has(value)) {
      return value;
    }
  }
  return null;
}

function exposedPorts(serviceDocument) {
  return (serviceDocument.spec?.ports ?? [])
    .map((port) => port.port)
    .filter((port) => typeof port === 'number');
}

// ── Deployability ───────────────────────────────────────────────────────────────────────

/**
 * Same precedence as `.github/actions/load-deploy-control/action.yml`:
 * global kill switch → environment → per-service.
 *
 * `auto_deploy: false` is only decisive when the environment is actually on an automated
 * footing. In `test`/`prod` every service is `auto_deploy: false` by design and reaches the
 * cluster by manual dispatch, so treating it as "not deployed" there would fail those
 * environments by construction.
 */
function deployabilityOf(control, environment, key) {
  const environmentBlock = control?.environments?.[environment];
  const service = environmentBlock?.services?.[key];

  if (!service) {
    return { deployable: false, reason: `no environments.${environment}.services.${key} entry` };
  }
  if (service.enabled !== true) {
    return { deployable: false, reason: 'enabled: false' };
  }

  const automated = control?.global?.auto_deploy !== false && environmentBlock.auto_deploy === true;
  if (automated && service.auto_deploy !== true) {
    return { deployable: false, reason: 'auto_deploy: false' };
  }

  return { deployable: true, reason: null };
}

/**
 * Every environment that deploys all of `keys`.
 *
 * `Active: false` is a global switch, so judging it needs a global answer: a route file
 * switched off while its service still runs somewhere is a defect no matter which
 * environment happens to be under validation.
 */
function environmentsDeploying(control, keys) {
  return Object.keys(control?.environments ?? {}).filter((environment) =>
    [...keys].every((key) => deployabilityOf(control, environment, key).deployable),
  );
}

// ── The check ───────────────────────────────────────────────────────────────────────────

/**
 * @param {object} options
 * @param {object[]} options.routeFiles   From `loadRouteFiles()`.
 * @param {object[]} options.documents    Rendered manifest documents for ONE environment.
 * @param {object|null} options.control   Parsed deploy-control.yaml, or null for providers
 *                                        that have none (podman/local). With null only the
 *                                        host/port resolution is enforced — a downstream no
 *                                        rendered Service provides is a local 502.
 * @param {string} options.environment    Environment name, quoted in every message.
 * @returns {{headline: string, detail: string[], items: string[]}[]}
 */
function resolveGatewayRouteProblems({ routeFiles, documents, control, environment }) {
  if (routeFiles.length === 0) {
    return [];
  }

  const registeredKeys = new Set(Object.keys(control?.environments?.[environment]?.services ?? {}));
  const services = servicesByName(documents);

  const unresolvedHosts = [];
  const unmappedHosts = [];
  const portMismatches = [];

  /** file → Set of deploy-control keys, only for files whose every downstream resolved. */
  const keysByFile = new Map();

  for (const routeFile of routeFiles) {
    const keys = new Set();
    let resolvedCleanly = true;

    // An inactive file is advertised nowhere, so its downstreams cannot 502 and its
    // host/port problems are not worth reporting. They are still RESOLVED, because that is
    // the only way to learn which deploy-control key it names and therefore whether the
    // service it fronts is still running somewhere.
    const reportHostProblems = routeFile.active;

    for (const downstream of routeFile.downstreams) {
      const where = `${routeFile.file} ${downstream.origin}`;

      if (!downstream.host) {
        if (reportHostProblems) {
          unresolvedHosts.push(
            `${where}: unparseable downstream ${JSON.stringify(downstream.raw)}`,
          );
        }
        resolvedCleanly = false;
        continue;
      }

      const serviceDocument = services.get(downstream.host);
      if (!serviceDocument) {
        if (reportHostProblems) {
          unresolvedHosts.push(
            `${where}: host '${downstream.host}' — no rendered Service by that name`,
          );
        }
        resolvedCleanly = false;
        continue;
      }

      const ports = exposedPorts(serviceDocument);
      if (downstream.port !== null && !ports.includes(downstream.port)) {
        if (reportHostProblems) {
          portMismatches.push(
            `${where}: '${downstream.host}:${downstream.port}' — Service exposes ${ports.join(', ') || '(no ports)'}`,
          );
        }
        resolvedCleanly = false;
      }

      // Gating can only be judged where a deploy-control registry exists at all.
      if (registeredKeys.size === 0) {
        continue;
      }

      const key = ownerKeyOf(serviceDocument, registeredKeys);
      if (!key) {
        if (reportHostProblems) {
          const labels = IDENTITY_LABELS.map((label) => serviceDocument.metadata?.labels?.[label])
            .filter(Boolean)
            .join(', ');
          unmappedHosts.push(
            `${where}: Service '${downstream.host}' carries no identity label naming a deploy-control key` +
              ` (has: ${labels || 'none'})`,
          );
        }
        resolvedCleanly = false;
        continue;
      }
      keys.add(key);
    }

    if (resolvedCleanly && keys.size > 0) {
      keysByFile.set(routeFile, keys);
    }
  }

  const problems = [];

  if (unresolvedHosts.length > 0) {
    problems.push({
      headline: 'Gateway route downstreams that no rendered Service provides',
      detail: [
        'Every downstream host must be the metadata.name of a Service rendered for this',
        'environment — that Service is what maps the host to a deploy-control key.',
        'An unroutable host is a 502 on the route and a 500 on /swagger/docs/v1/<Service>.',
      ],
      items: unresolvedHosts,
    });
  }

  if (unmappedHosts.length > 0) {
    problems.push({
      headline: 'Gateway route downstreams that map to no deploy-control key',
      detail: [
        `Identity labels, in precedence order: ${IDENTITY_LABELS.join(', ')} — the same rule`,
        'tools/infra/deploy-scope.js applies. Without one, whether the service deploys here',
        'cannot be answered, so a renamed service would silently stop being checked.',
      ],
      items: unmappedHosts,
    });
  }

  if (portMismatches.length > 0) {
    problems.push({
      headline: 'Gateway route downstream ports the rendered Service does not expose',
      detail: ['The route would resolve DNS and then fail to connect — a 502 with no log line.'],
      items: portMismatches,
    });
  }

  if (registeredKeys.size === 0) {
    return problems;
  }

  const deployment = gatewayDeployment(documents);
  if (!deployment) {
    problems.push({
      headline: `No rendered api-gateway Deployment to read ${DISABLED_SERVICES_ENV} from`,
      detail: [
        `Expected a Deployment labelled ${IDENTITY_LABELS[0]}=${GATEWAY_KEY} in this environment.`,
        'Without it the set of advertised services is unknown and cannot be verified.',
      ],
      items: [environment],
    });
    return problems;
  }

  const declared = new Set(declaredDisabledServices(deployment));

  const advertisedButUndeployable = [];
  const suppressedButDeployable = [];
  const inactiveButDeployable = [];
  /** ServiceNames the Active rule already reported, so nothing reports them twice. */
  const reportedInactive = new Set();

  for (const [routeFile, keys] of keysByFile) {
    const blockers = [...keys]
      .map((key) => ({ key, ...deployabilityOf(control, environment, key) }))
      .filter((result) => !result.deployable);
    const declaredHere = routeFile.serviceName !== null && declared.has(routeFile.serviceName);

    // `Active: false` un-advertises everywhere, so it is judged against every environment,
    // not just this one — and it takes precedence over the per-environment rules below, so
    // one cause never produces two errors.
    if (!routeFile.active) {
      const deploying = environmentsDeploying(control, keys);
      if (deploying.length > 0) {
        reportedInactive.add(routeFile.serviceName);
        inactiveButDeployable.push(
          `${routeFile.file} (ServiceName "${routeFile.serviceName}") is advertised in no environment ` +
            `(${describeInactive(routeFile)}), but deploy-control deploys ${[...keys].join(', ')} in: ` +
            `${deploying.join(', ')} — the service would run with no route through the gateway and no ` +
            `entry in the Swagger aggregation. ${describeInactiveFix(routeFile)}`,
        );
      }
      continue;
    }

    if (blockers.length > 0 && !declaredHere) {
      const hosts = [
        ...new Set(routeFile.downstreams.map((down) => `${down.host}:${down.port}`)),
      ].join(', ');
      const origins = routeFile.downstreams.map((down) => down.origin).join(', ');
      advertisedButUndeployable.push(
        `${routeFile.file} (ServiceName "${routeFile.serviceName}") advertises ${hosts} in '${environment}', ` +
          `but ${blockers.map((blocker) => `deploy-control service '${blocker.key}' has ${blocker.reason}`).join('; ')}` +
          ` — via ${origins}`,
      );
    }

    if (blockers.length === 0 && declaredHere) {
      suppressedButDeployable.push(
        `${routeFile.file} (ServiceName "${routeFile.serviceName}") is listed in ${DISABLED_SERVICES_ENV} for ` +
          `'${environment}', but ${[...keys].join(', ')} is deployable there — the service would run unreachable`,
      );
    }
  }

  // A declared name matching an INACTIVE route file is redundant, not stale: the file
  // exists, it is just already switched off globally. Saying "stale" would send the reader
  // hunting for a deleted file. Both mechanisms at once is still wrong — one decision,
  // one switch — unless the Active rule already reported this file.
  const inactiveServiceNames = new Set(
    routeFiles.filter((routeFile) => !routeFile.active).map((routeFile) => routeFile.serviceName),
  );
  const knownServiceNames = new Set(routeFiles.map((routeFile) => routeFile.serviceName));

  const redundant = [...declared].filter(
    (name) => inactiveServiceNames.has(name) && !reportedInactive.has(name),
  );
  const stale = [...declared].filter((name) => !knownServiceNames.has(name));

  if (advertisedButUndeployable.length > 0) {
    problems.push({
      headline: 'Gateway route files advertise a service this environment will not deploy',
      detail: [
        'The gateway would start, publish these routes and their SwaggerEndPoints entry, and',
        'then serve 502 on the routes and 500 on /swagger/docs/v1/<Service> — which takes out',
        'the entire Swagger aggregation endpoint, not just that one document (#22, #71).',
        `Fix by either enabling the service in infra/deploy-control.yaml for '${environment}',`,
        `or adding its ServiceName to ${DISABLED_SERVICES_ENV} on the api-gateway Deployment`,
        `patch for '${environment}'.`,
      ],
      items: advertisedButUndeployable,
    });
  }

  if (inactiveButDeployable.length > 0) {
    problems.push({
      headline: 'Gateway route files switched off with Active: false while their service deploys',
      detail: [
        'Active is a GLOBAL kill switch inside the route file — it un-advertises the service',
        'in every environment at once. Used on a service that deploy-control still deploys, it',
        'produces the mirror image of the #22/#71 outage: the pod runs, but nothing routes to',
        'it and its document is missing from the Swagger aggregation.',
        `For "deployed here but not there", use ${DISABLED_SERVICES_ENV} on the api-gateway`,
        'Deployment patch instead — that is the per-environment switch, and this check keeps it',
        'in step with deploy-control automatically.',
      ],
      items: inactiveButDeployable,
    });
  }

  if (suppressedButDeployable.length > 0 || redundant.length > 0 || stale.length > 0) {
    problems.push({
      headline: `${DISABLED_SERVICES_ENV} does not match what infra/deploy-control.yaml deploys`,
      detail: [
        'This value is derived, not authored: it must name exactly the active route files',
        'whose service is not deployable in this environment. Over-suppressing hides a',
        'running service behind the gateway just as silently as under-suppressing exposes a',
        'missing one.',
      ],
      items: [
        ...suppressedButDeployable,
        ...redundant.map(
          (name) =>
            `'${name}' is listed in ${DISABLED_SERVICES_ENV} for '${environment}' AND its route file is ` +
            `already inactive — pick one mechanism: Active for "never, anywhere", ` +
            `${DISABLED_SERVICES_ENV} for "not in this environment"`,
        ),
        ...stale.map(
          (name) =>
            `'${name}' is listed in ${DISABLED_SERVICES_ENV} for '${environment}' but matches no route file — stale entry`,
        ),
      ],
    });
  }

  return problems;
}

module.exports = {
  ROUTES_DIR,
  DISABLED_SERVICES_ENV,
  GATEWAY_KEY,
  parseRouteFile,
  loadRouteFiles,
  deployabilityOf,
  resolveGatewayRouteProblems,
};
