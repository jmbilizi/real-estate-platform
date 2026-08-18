#!/usr/bin/env node

'use strict';

/**
 * Deploy scope resolution — the ONE place that answers:
 *
 *   1. Which `infra/deploy-control.yaml` entry owns each rendered Kubernetes resource?
 *   2. Which label selector applies exactly that entry's resources and nothing else?
 *   3. Which workloads are in scope for this run, and which are deliberately gated off?
 *   4. In what order may the service lanes run without racing an admission webhook?
 *
 * Both consumers import this module, so they cannot disagree:
 *
 *   - `tools/infra/validate-kustomize.js` (git hooks + CI) — fails the build when the
 *     manifests and deploy-control.yaml have drifted apart.
 *   - `.github/actions/deploy-k8s-resources/action.yml` — runs this file as a CLI to
 *     produce `scope.txt` / `scope-plan.json`, which every later step reads.
 *
 * The CI/CD action has no `node_modules` (the deploy workflow never runs `pnpm install`),
 * so the CLI consumes JSON produced by `yq` rather than parsing YAML itself. The library
 * entry points take plain objects and stay dependency-free.
 *
 * ── The identity rule ──────────────────────────────────────────────────────────────────
 *
 * A resource belongs to the deploy-control key named by one of its identity LABELS, in
 * this order: `app`, then `app.kubernetes.io/name`. There is deliberately NO
 * `metadata.name` fallback: the deploy action selects resources with `kubectl apply -l`,
 * which can only ever match a label. An identity derived from a name would validate green
 * and then select nothing (`error: no objects passed to apply`).
 *
 * Consequences, all enforced below:
 *   - A workload matching no key at all is UNMANAGED — a hard error. This is what
 *     "adding a new workload without a deploy-control entry is caught by CI" means.
 *   - A workload whose two labels name two different keys is AMBIGUOUS — a hard error,
 *     because it would otherwise be applied, waited on, and rolled back by two lanes.
 *   - A key whose resources share no single covering label is UNSELECTABLE — a hard
 *     error, because no one `kubectl apply -l` could reach all of them.
 *   - A key that owns no resource at all is EMPTY — a hard error in validation, and at
 *     deploy time when that key is actually requested.
 *
 * Gating (`enabled` / `auto_deploy`) is NOT part of identity. A service that is registered
 * but switched off is reported as out of scope; it is never confused with an unregistered
 * one. Conflating the two is what made one `auto_deploy: false` abort an entire deploy.
 */

const fs = require('fs');
const path = require('path');

/** Identity labels, most specific first. See "The identity rule" above. */
const IDENTITY_LABELS = ['app', 'app.kubernetes.io/name'];

/** Kinds the deploy pipeline applies, waits on, restarts and rolls back. */
const WORKLOAD_KINDS = ['StatefulSet', 'Deployment', 'DaemonSet'];

const WEBHOOK_KINDS = ['ValidatingWebhookConfiguration', 'MutatingWebhookConfiguration'];

/** Admission operations that can reject another lane's apply. */
const BLOCKING_OPERATIONS = ['CREATE', 'UPDATE', '*'];

function resourceRef(document) {
  return {
    kind: document.kind,
    namespace: document.metadata?.namespace ?? 'default',
    name: document.metadata?.name,
  };
}

function refToLine(ref) {
  return `${ref.kind}|${ref.namespace}|${ref.name}`;
}

function refToText(ref) {
  return `${ref.kind} ${ref.namespace} ${ref.name}`;
}

/**
 * The label values that could name a deploy-control key for this document, in
 * precedence order. Empty/non-string labels are ignored.
 */
function identityCandidates(document) {
  const labels = document?.metadata?.labels ?? {};
  return IDENTITY_LABELS.map((label) => ({ label, value: labels[label] })).filter(
    (candidate) => typeof candidate.value === 'string' && candidate.value.length > 0,
  );
}

/** Every registered key this document's labels name (normally exactly one). */
function ownersOf(document, registeredKeys) {
  const seen = new Set();
  return identityCandidates(document).filter((candidate) => {
    if (!registeredKeys.has(candidate.value) || seen.has(candidate.value)) {
      return false;
    }
    seen.add(candidate.value);
    return true;
  });
}

/** `Ingress` → `ingresses`, `Deployment` → `deployments`, `NetworkPolicy` → `networkpolicies`. */
function pluralizeKind(kind) {
  const lower = String(kind || '').toLowerCase();
  if (!lower) return '';
  if (/(s|x|z|ch|sh)$/.test(lower)) return `${lower}es`;
  if (/[^aeiou]y$/.test(lower)) return `${lower.slice(0, -1)}ies`;
  return `${lower}s`;
}

/** `networking.k8s.io/v1` → `networking.k8s.io`; `v1` → `` (core group). */
function apiGroupOf(apiVersion) {
  const value = String(apiVersion || '');
  return value.includes('/') ? value.split('/')[0] : '';
}

function groupResource(group, resource) {
  return `${group}/${resource}`;
}

/** The `group/resource` pairs an admission webhook config intercepts on write. */
function gatedGroupResources(document) {
  const gated = new Set();
  for (const webhook of document.webhooks ?? []) {
    for (const rule of webhook.rules ?? []) {
      const operations = rule.operations ?? [];
      if (!operations.some((operation) => BLOCKING_OPERATIONS.includes(operation))) {
        continue;
      }
      for (const group of rule.apiGroups ?? []) {
        for (const resource of rule.resources ?? []) {
          gated.add(groupResource(group, resource));
        }
      }
    }
  }
  return gated;
}

function gateMatches(gated, group, resource) {
  return (
    gated.has(groupResource(group, resource)) ||
    gated.has(groupResource('*', resource)) ||
    gated.has(groupResource(group, '*')) ||
    gated.has(groupResource('*', '*'))
  );
}

function containerImages(document) {
  const spec = document.spec?.template?.spec ?? {};
  return [...(spec.initContainers ?? []), ...(spec.containers ?? [])]
    .map((container) => container?.image)
    .filter((image) => typeof image === 'string');
}

/**
 * Order the in-scope lanes so a lane never applies a resource that another lane's
 * admission webhook is still being created or patched for. Layered topological sort;
 * every service in a phase may run in parallel, phases run in order.
 */
function computePhases(services, documentsByService) {
  const names = services.map((service) => service.name);
  const inScope = new Set(names);

  const gates = new Map();
  const provides = new Map();
  for (const name of names) {
    const documents = documentsByService.get(name) ?? [];
    const gated = new Set();
    const provided = new Set();
    for (const document of documents) {
      provided.add(groupResource(apiGroupOf(document.apiVersion), pluralizeKind(document.kind)));
      if (WEBHOOK_KINDS.includes(document.kind)) {
        for (const entry of gatedGroupResources(document)) {
          gated.add(entry);
        }
      }
    }
    gates.set(name, gated);
    provides.set(name, provided);
  }

  // Edge gatekeeper → dependent: the gatekeeper's lane must complete first.
  const dependencies = new Map(names.map((name) => [name, new Set()]));
  for (const gatekeeper of names) {
    const gated = gates.get(gatekeeper);
    if (gated.size === 0) continue;
    for (const dependent of names) {
      if (dependent === gatekeeper) continue;
      const blocked = [...provides.get(dependent)].some((entry) => {
        const [group, resource] = [
          entry.slice(0, entry.indexOf('/')),
          entry.slice(entry.indexOf('/') + 1),
        ];
        return gateMatches(gated, group, resource);
      });
      if (blocked) {
        dependencies.get(dependent).add(gatekeeper);
      }
    }
  }

  const phases = [];
  const placed = new Set();
  while (placed.size < inScope.size) {
    const ready = names.filter(
      (name) =>
        !placed.has(name) &&
        [...dependencies.get(name)].every((dependency) => placed.has(dependency)),
    );
    if (ready.length === 0) {
      // Cyclic gating cannot be ordered; run what is left together rather than hanging.
      phases.push({
        services: names.filter((name) => !placed.has(name)),
        note: 'cyclic admission gating detected — running the remainder together',
      });
      break;
    }
    phases.push({
      services: ready,
      note:
        phases.length === 0
          ? 'no admission dependency'
          : `waits for: ${[...new Set(ready.flatMap((name) => [...dependencies.get(name)]))].join(', ')}`,
    });
    for (const name of ready) {
      placed.add(name);
    }
  }

  return phases;
}

/**
 * @param {object} options
 * @param {object[]} options.documents          Every rendered manifest document.
 * @param {string[]} options.registeredKeys     `environments.<env>.services` keys.
 * @param {string[]|null} options.requestedServices  Services this run should apply; null/['all'] = every registered key.
 * @param {string} [options.firstPartyImagePrefix]   e.g. `ghcr.io/owner/repo/`.
 */
function resolveDeployScope({
  documents,
  registeredKeys,
  requestedServices = null,
  firstPartyImagePrefix = '',
}) {
  const keys = new Set(registeredKeys);
  const documentsByService = new Map(registeredKeys.map((key) => [key, []]));

  const unmanaged = [];
  const ambiguous = [];
  const workloads = [];

  for (const document of documents) {
    if (!document || !document.kind) continue;
    const owners = ownersOf(document, keys);
    const isWorkload = WORKLOAD_KINDS.includes(document.kind);

    for (const owner of owners) {
      documentsByService.get(owner.value).push(document);
    }

    if (!isWorkload) continue;

    const ref = resourceRef(document);
    if (owners.length === 0) {
      unmanaged.push({
        ...ref,
        labels: identityCandidates(document).map(({ label, value }) => `${label}=${value}`),
      });
      continue;
    }
    if (owners.length > 1) {
      ambiguous.push({ ...ref, owners: owners.map((owner) => `${owner.label}=${owner.value}`) });
      continue;
    }
    workloads.push({
      ...ref,
      service: owners[0].value,
      firstParty:
        firstPartyImagePrefix.length > 0 &&
        containerImages(document).some((image) => image.startsWith(firstPartyImagePrefix)),
    });
  }

  // One label selector must reach every resource a key owns, or the lane applies a subset.
  const unselectable = [];
  const emptyKeys = [];
  const services = [];
  for (const key of registeredKeys) {
    const owned = documentsByService.get(key);
    if (owned.length === 0) {
      emptyKeys.push(key);
      continue;
    }
    const label = IDENTITY_LABELS.find((candidate) =>
      owned.every((document) => document.metadata?.labels?.[candidate] === key),
    );
    if (!label) {
      unselectable.push({
        service: key,
        resources: owned.map((document) => refToText(resourceRef(document))),
      });
      continue;
    }
    services.push({
      name: key,
      selector: `${label}=${key}`,
      workloads: workloads.filter((workload) => workload.service === key),
    });
  }

  const wantsAll =
    requestedServices === null ||
    requestedServices.length === 0 ||
    requestedServices.includes('all');
  const requested = wantsAll ? services.map((service) => service.name) : [...requestedServices];
  const unknownRequested = requested.filter((name) => !keys.has(name));
  const requestedButEmpty = requested.filter((name) => keys.has(name) && emptyKeys.includes(name));
  const inScopeServices = services.filter((service) => requested.includes(service.name));

  const inScope = workloads.filter((workload) => requested.includes(workload.service));
  const outOfScope = workloads
    .filter((workload) => !requested.includes(workload.service))
    .map((workload) => ({
      ...workload,
      reason: `deploy-control entry '${workload.service}' is not in scope for this run (enabled/auto_deploy gated off, or not requested)`,
    }));

  const inScopeDocumentsByService = new Map(
    inScopeServices.map((service) => [service.name, documentsByService.get(service.name)]),
  );

  return {
    services,
    inScopeServices,
    inScope,
    outOfScope,
    restartDeployments: inScope.filter(
      (workload) => workload.kind === 'Deployment' && workload.firstParty,
    ),
    phases: computePhases(inScopeServices, inScopeDocumentsByService),
    errors: { unmanaged, ambiguous, unselectable, emptyKeys, unknownRequested, requestedButEmpty },
  };
}

/**
 * Human-readable findings. `mode: 'validate'` treats every empty key as fatal; the deploy
 * path only fails on empty keys it was actually asked to deploy.
 */
function describeProblems(result, { mode = 'validate' } = {}) {
  const { unmanaged, ambiguous, unselectable, emptyKeys, unknownRequested, requestedButEmpty } =
    result.errors;
  const problems = [];

  if (unmanaged.length > 0) {
    problems.push({
      headline: 'Unmanaged workloads — no deploy-control entry claims them',
      detail: [
        'Every workload must carry an identity label whose value is a key under',
        'environments.<env>.services in infra/deploy-control.yaml.',
        `Identity labels, in precedence order: ${IDENTITY_LABELS.join(', ')}.`,
        'metadata.name is NOT an identity: the deploy applies with `kubectl apply -l`.',
      ],
      items: unmanaged.map(
        (item) =>
          `${refToText(item)}${item.labels.length ? ` (labels: ${item.labels.join(', ')})` : ' (no identity labels)'}`,
      ),
    });
  }

  if (ambiguous.length > 0) {
    problems.push({
      headline: 'Ambiguous workloads — two deploy-control entries claim the same object',
      detail: [
        'Both identity labels name a registered service, so two lanes would apply the same',
        'object, wait on it twice, and roll it back two revisions on failure.',
        'Remove one label, or remove one of the deploy-control keys.',
      ],
      items: ambiguous.map((item) => `${refToText(item)} (claimed by: ${item.owners.join(', ')})`),
    });
  }

  if (unselectable.length > 0) {
    problems.push({
      headline: 'Unselectable services — no single label selector covers all their resources',
      detail: [
        'The lane applies with one `kubectl apply -l <label>=<service>`, so every resource',
        'belonging to the service must carry the same identity label.',
      ],
      items: unselectable.map((item) => `${item.service}: ${item.resources.join('; ')}`),
    });
  }

  const fatalEmptyKeys = mode === 'validate' ? emptyKeys : requestedButEmpty;
  if (fatalEmptyKeys.length > 0) {
    problems.push({
      headline: 'Stale deploy-control entries — registered but matching no rendered resource',
      detail: [
        'The key names a service that the manifests do not contain (typo, or removed',
        'workload). Its lane would fail with "no objects passed to apply" and trigger a',
        'rollback for something that was never deployed.',
      ],
      items: fatalEmptyKeys,
    });
  }

  if (unknownRequested.length > 0) {
    problems.push({
      headline: 'Requested services with no deploy-control entry',
      detail: ['Add the key under environments.<env>.services, or correct the request.'],
      items: unknownRequested,
    });
  }

  return problems;
}

function hasFatalProblems(result, options) {
  return describeProblems(result, options).length > 0;
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      args[key] = 'true';
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function printProblems(problems) {
  for (const problem of problems) {
    console.error(`\n❌ ${problem.headline}:`);
    for (const item of problem.items) {
      console.error(`     - ${item}`);
    }
    for (const line of problem.detail) {
      console.error(`   ${line}`);
    }
  }
}

function main(argv) {
  const args = parseArgs(argv);
  const environment = args.environment;
  if (!args['manifests-json'] || !args['control-json'] || !environment) {
    console.error(
      'Usage: deploy-scope.js --manifests-json <file> --control-json <file> --environment <env>\n' +
        '                      [--services <csv|all>] [--first-party-image-prefix <prefix>]\n' +
        '                      [--out-dir <dir>]',
    );
    return 2;
  }

  const documents = readJson(args['manifests-json']).filter(Boolean);
  const control = readJson(args['control-json']);
  const registeredKeys = Object.keys(control?.environments?.[environment]?.services ?? {});
  if (registeredKeys.length === 0) {
    console.error(`❌ deploy-control.yaml has no environments.${environment}.services entries.`);
    return 1;
  }

  const requestedServices =
    args.services && args.services !== 'all'
      ? args.services
          .split(',')
          .map((name) => name.trim())
          .filter(Boolean)
      : null;

  const result = resolveDeployScope({
    documents,
    registeredKeys,
    requestedServices,
    firstPartyImagePrefix: args['first-party-image-prefix'] ?? '',
  });

  const problems = describeProblems(result, { mode: 'deploy' });
  if (problems.length > 0) {
    printProblems(problems);
    console.error('\n   Refusing to deploy: the manifests and deploy-control.yaml disagree.');
    return 1;
  }

  if (result.errors.emptyKeys.length > 0) {
    console.log(
      `\n⚠️  deploy-control entries with no rendered resource (not requested this run): ${result.errors.emptyKeys.join(', ')}`,
    );
  }

  if (result.inScope.length === 0) {
    console.error('\n❌ Deploy scope is empty — no in-scope service owns a workload.');
    console.error(`   Requested: ${requestedServices ? requestedServices.join(', ') : 'all'}`);
    return 1;
  }

  const outDir = args['out-dir'] ?? '.';
  const scopeLines = result.inScope.map(refToLine).sort();
  fs.writeFileSync(path.join(outDir, 'scope.txt'), `${scopeLines.join('\n')}\n`);
  fs.writeFileSync(
    path.join(outDir, 'restart-deployments.txt'),
    result.restartDeployments.length > 0
      ? `${result.restartDeployments
          .map((workload) => `${workload.namespace}|${workload.name}`)
          .sort()
          .join('\n')}\n`
      : '',
  );
  fs.writeFileSync(
    path.join(outDir, 'scope-plan.json'),
    `${JSON.stringify(
      {
        environment,
        services: result.inScopeServices,
        phases: result.phases,
        restartDeployments: result.restartDeployments,
      },
      null,
      2,
    )}\n`,
  );

  console.log(`\n✅ In scope (${result.inScope.length} workloads):`);
  for (const line of scopeLines) {
    console.log(`     - ${line.replace(/\|/g, ' ')}`);
  }

  console.log('\n📑 Lane order (phases run in sequence, services within a phase in parallel):');
  result.phases.forEach((phase, index) => {
    console.log(`     ${index}. ${phase.services.join(', ')}  — ${phase.note}`);
  });

  if (result.outOfScope.length > 0) {
    console.log('\nℹ️  NOT in scope this run (registered, but gated off or not requested):');
    for (const workload of result.outOfScope) {
      console.log(`     - ${refToText(workload)}  [${workload.service}]`);
    }
    console.log('   These are skipped by every later step, not treated as failures.');
  }

  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = {
  IDENTITY_LABELS,
  WORKLOAD_KINDS,
  identityCandidates,
  ownersOf,
  pluralizeKind,
  apiGroupOf,
  computePhases,
  resolveDeployScope,
  describeProblems,
  hasFatalProblems,
  main,
};
