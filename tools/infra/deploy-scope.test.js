'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const yaml = require('js-yaml');

const {
  IDENTITY_LABELS,
  identityCandidates,
  pluralizeKind,
  apiGroupOf,
  resolveDeployScope,
  describeProblems,
  main,
} = require('./deploy-scope');

const REPO_ROOT = path.resolve(__dirname, '../..');
const FIXTURE = path.join(__dirname, 'fixtures/hetzner-dev.manifests.yaml');

function loadYamlDocuments(text) {
  const documents = [];
  yaml.loadAll(text, (document) => document && documents.push(document));
  return documents;
}

function devDocuments() {
  return loadYamlDocuments(fs.readFileSync(FIXTURE, 'utf-8'));
}

function deployControl() {
  return yaml.load(fs.readFileSync(path.join(REPO_ROOT, 'infra/deploy-control.yaml'), 'utf-8'));
}

function registeredKeys(environment) {
  return Object.keys(deployControl().environments?.[environment]?.services ?? {});
}

/**
 * Reproduces `.github/actions/load-deploy-control/action.yml`: a service reaches the deploy
 * action only when BOTH `enabled` and `auto_deploy` are true. The point of the tests below
 * is that this gating set is NOT the same thing as the registry, and must never be used to
 * decide whether a workload is unmanaged.
 */
function allowedServices(environment, overrides = {}) {
  const services = deployControl().environments?.[environment]?.services ?? {};
  return Object.entries(services)
    .map(([name, config]) => [name, { ...config, ...(overrides[name] ?? {}) }])
    .filter(([, config]) => config.enabled === true && config.auto_deploy === true)
    .map(([name]) => name);
}

const IDENTITY_ONLY = (kind, name, labels, extra = {}) => ({
  apiVersion: 'apps/v1',
  kind,
  metadata: { name, labels },
  ...extra,
});

// ── The identity rule ───────────────────────────────────────────────────────────────────

test('identity comes from labels only, never metadata.name', () => {
  assert.deepEqual(IDENTITY_LABELS, ['app', 'app.kubernetes.io/name']);

  const unlabelled = IDENTITY_ONLY('Deployment', 'some-controller', undefined);
  assert.deepEqual(identityCandidates(unlabelled), []);

  const result = resolveDeployScope({
    documents: [unlabelled],
    registeredKeys: ['some-controller'],
  });

  // A metadata.name fallback would certify this config, and the deploy action would then
  // apply `-l app.kubernetes.io/name=some-controller` and match nothing.
  assert.equal(result.errors.unmanaged.length, 1);
  assert.equal(result.errors.unmanaged[0].name, 'some-controller');
});

test('a dual-labelled workload resolves to whichever label names a registered key', () => {
  // The upstream ingress-nginx Deployment carries only app.kubernetes.io/name today. If
  // anyone adds `app: ingress-nginx-controller` for consistency with the rest of
  // infra/k8s/base, the `ingress-nginx` key must keep owning it — not become "unmanaged".
  const dualLabelled = IDENTITY_ONLY('Deployment', 'ingress-nginx-controller', {
    app: 'ingress-nginx-controller',
    'app.kubernetes.io/name': 'ingress-nginx',
  });

  const result = resolveDeployScope({
    documents: [dualLabelled],
    registeredKeys: ['ingress-nginx'],
  });

  assert.deepEqual(result.errors.unmanaged, []);
  assert.deepEqual(result.errors.ambiguous, []);
  assert.equal(result.inScope.length, 1);
  assert.equal(result.inScope[0].service, 'ingress-nginx');
});

test('a workload claimed by two registered keys is a hard error, not a double lane', () => {
  const dualLabelled = IDENTITY_ONLY('Deployment', 'controller', {
    app: 'ingress-nginx-controller',
    'app.kubernetes.io/name': 'ingress-nginx',
  });

  const result = resolveDeployScope({
    documents: [dualLabelled],
    registeredKeys: ['ingress-nginx', 'ingress-nginx-controller'],
  });

  assert.equal(result.errors.ambiguous.length, 1);
  assert.deepEqual(result.errors.ambiguous[0].owners, [
    'app=ingress-nginx-controller',
    'app.kubernetes.io/name=ingress-nginx',
  ]);
  // Two lanes would apply it twice, wait on it twice, and undo two revisions on failure.
  assert.match(describeProblems(result)[0].headline, /Ambiguous/);
});

test('a service whose resources share no single covering label is unselectable', () => {
  const result = resolveDeployScope({
    documents: [
      IDENTITY_ONLY('Deployment', 'a', { app: 'split' }),
      IDENTITY_ONLY('Service', 'b', { 'app.kubernetes.io/name': 'split' }),
    ],
    registeredKeys: ['split'],
  });

  assert.equal(result.errors.unselectable.length, 1);
  assert.equal(result.errors.unselectable[0].service, 'split');
});

test('a registered key matching no rendered resource is caught (reverse check)', () => {
  const result = resolveDeployScope({
    documents: [IDENTITY_ONLY('Deployment', 'postgres', { app: 'postgres' })],
    registeredKeys: ['postgres', 'typo-service'],
  });

  assert.deepEqual(result.errors.emptyKeys, ['typo-service']);
  // Fatal when validating the repo…
  assert.match(describeProblems(result, { mode: 'validate' })[0].headline, /Stale deploy-control/);
  // …but a gated-off stale key must not abort a deploy that never asked for it.
  assert.deepEqual(describeProblems(result, { mode: 'deploy' }), []);
});

// ── Acceptance criteria: opting one service out ─────────────────────────────────────────

test('AC: with every dev service enabled, all nine workloads are in scope', () => {
  const result = resolveDeployScope({
    documents: devDocuments(),
    registeredKeys: registeredKeys('dev'),
    requestedServices: allowedServices('dev'),
  });

  assert.deepEqual(describeProblems(result, { mode: 'deploy' }), []);
  assert.equal(result.inScope.length, 9);
  assert.deepEqual(result.outOfScope, []);

  const names = result.inScope.map((workload) => `${workload.kind}/${workload.name}`).sort();
  assert.deepEqual(names, [
    'Deployment/account-service',
    'Deployment/api-gateway',
    'Deployment/cribstop-web',
    'Deployment/inference',
    'Deployment/ingress-nginx-controller',
    'Deployment/property-service',
    'StatefulSet/jaeger',
    'StatefulSet/postgres',
    'StatefulSet/redis',
  ]);
});

test('AC: opting property-service out removes exactly that workload — nothing else changes', () => {
  const allEnabled = resolveDeployScope({
    documents: devDocuments(),
    registeredKeys: registeredKeys('dev'),
    requestedServices: allowedServices('dev'),
  });

  const optedOut = resolveDeployScope({
    documents: devDocuments(),
    registeredKeys: registeredKeys('dev'),
    requestedServices: allowedServices('dev', { 'property-service': { auto_deploy: false } }),
  });

  // The regression this ticket exists to prevent: a deliberate opt-out must NOT be read as
  // drift, and must NOT stop the run.
  assert.deepEqual(describeProblems(optedOut, { mode: 'deploy' }), []);

  assert.equal(optedOut.inScope.length, 8);
  assert.equal(optedOut.outOfScope.length, 1);
  assert.equal(optedOut.outOfScope[0].name, 'property-service');
  assert.equal(optedOut.outOfScope[0].service, 'property-service');

  const before = new Set(allEnabled.inScope.map((w) => `${w.kind}/${w.namespace}/${w.name}`));
  const after = new Set(optedOut.inScope.map((w) => `${w.kind}/${w.namespace}/${w.name}`));
  const removed = [...before].filter((ref) => !after.has(ref));
  assert.deepEqual(removed, ['Deployment/default/property-service']);

  // Jaeger and ingress-nginx — the two workloads #45 was filed about — stay in scope.
  assert.ok(after.has('StatefulSet/default/jaeger'));
  assert.ok(after.has('Deployment/ingress-nginx/ingress-nginx-controller'));
});

test('AC: a genuinely unregistered workload fails, and says why', () => {
  const documents = devDocuments();
  documents.push(IDENTITY_ONLY('Deployment', 'messaging-service', { app: 'messaging-service' }));

  const result = resolveDeployScope({
    documents,
    registeredKeys: registeredKeys('dev'),
    requestedServices: allowedServices('dev', { 'property-service': { auto_deploy: false } }),
  });

  const problems = describeProblems(result, { mode: 'deploy' });
  assert.equal(problems.length, 1);
  assert.match(problems[0].headline, /Unmanaged workloads/);
  assert.deepEqual(problems[0].items, [
    'Deployment default messaging-service (labels: app=messaging-service)',
  ]);
  // The unregistered workload is the only complaint — the opted-out one is not conflated.
  assert.ok(!problems[0].items.some((item) => item.includes('property-service')));
});

test('a targeted single-service deploy (workflow_dispatch) resolves, it does not abort', () => {
  const result = resolveDeployScope({
    documents: devDocuments(),
    registeredKeys: registeredKeys('dev'),
    requestedServices: ['postgres'],
  });

  assert.deepEqual(describeProblems(result, { mode: 'deploy' }), []);
  assert.equal(result.inScope.length, 1);
  assert.equal(result.inScope[0].name, 'postgres');
  assert.equal(result.outOfScope.length, 8);
});

// ── Selectors, phases, restarts ─────────────────────────────────────────────────────────

test('selectors match the label each service actually carries', () => {
  const result = resolveDeployScope({
    documents: devDocuments(),
    registeredKeys: registeredKeys('dev'),
  });
  const selectors = Object.fromEntries(
    result.services.map((service) => [service.name, service.selector]),
  );

  assert.equal(selectors.postgres, 'app=postgres');
  assert.equal(selectors.jaeger, 'app=jaeger');
  // All 18 upstream ingress-nginx resources carry only app.kubernetes.io/name.
  assert.equal(selectors['ingress-nginx'], 'app.kubernetes.io/name=ingress-nginx');
});

test('the ingress admission webhook orders its lane ahead of every Ingress owner', () => {
  const result = resolveDeployScope({
    documents: devDocuments(),
    registeredKeys: registeredKeys('dev'),
    requestedServices: allowedServices('dev'),
  });

  const phaseOf = (service) => result.phases.findIndex((phase) => phase.services.includes(service));

  // ValidatingWebhookConfiguration/ingress-nginx-admission is failurePolicy: Fail on
  // Ingress CREATE/UPDATE, so applying an Ingress concurrently with it is a race.
  const gatekeeper = phaseOf('ingress-nginx');
  for (const owner of ['api-gateway', 'cribstop-web', 'jaeger']) {
    assert.ok(phaseOf(owner) > gatekeeper, `${owner} must run after ingress-nginx`);
  }
  // Services that own no Ingress are not needlessly serialised.
  assert.equal(phaseOf('postgres'), gatekeeper);
});

test('phases collapse when the gatekeeper is not in scope', () => {
  const result = resolveDeployScope({
    documents: devDocuments(),
    registeredKeys: registeredKeys('dev'),
    requestedServices: ['api-gateway', 'postgres'],
  });

  assert.equal(result.phases.length, 1);
  assert.deepEqual(result.phases[0].services.sort(), ['api-gateway', 'postgres']);
});

test('only first-party images are marked for rollout restart', () => {
  const result = resolveDeployScope({
    documents: devDocuments(),
    registeredKeys: registeredKeys('dev'),
    requestedServices: allowedServices('dev'),
    firstPartyImagePrefix: 'ghcr.io/GITHUB_REPOSITORY_OWNER/GITHUB_REPOSITORY_NAME/',
  });

  const restarted = result.restartDeployments.map((workload) => workload.name).sort();
  assert.deepEqual(restarted, [
    'account-service',
    'api-gateway',
    'cribstop-web',
    'inference',
    'property-service',
  ]);
  // The upstream controller image is digest-pinned; restarting it cannot pull anything new.
  assert.ok(!restarted.includes('ingress-nginx-controller'));
});

test('kind pluralisation and api group extraction', () => {
  assert.equal(pluralizeKind('Ingress'), 'ingresses');
  assert.equal(pluralizeKind('Deployment'), 'deployments');
  assert.equal(pluralizeKind('NetworkPolicy'), 'networkpolicies');
  assert.equal(apiGroupOf('networking.k8s.io/v1'), 'networking.k8s.io');
  assert.equal(apiGroupOf('v1'), '');
});

// ── CLI (this is what the deploy action actually invokes) ───────────────────────────────

function runCli(documents, environment, services) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-scope-'));
  fs.writeFileSync(path.join(dir, 'manifests.json'), JSON.stringify(documents));
  fs.writeFileSync(path.join(dir, 'control.json'), JSON.stringify(deployControl()));
  const code = main([
    '--manifests-json',
    path.join(dir, 'manifests.json'),
    '--control-json',
    path.join(dir, 'control.json'),
    '--environment',
    environment,
    '--services',
    services,
    '--first-party-image-prefix',
    'ghcr.io/GITHUB_REPOSITORY_OWNER/GITHUB_REPOSITORY_NAME/',
    '--out-dir',
    dir,
  ]);
  return { code, dir };
}

test('CLI writes scope.txt and a lane plan, and exits 0 with a service opted out', () => {
  const services = allowedServices('dev', { 'property-service': { auto_deploy: false } });
  const { code, dir } = runCli(devDocuments(), 'dev', services.join(','));

  assert.equal(code, 0);

  const scope = fs.readFileSync(path.join(dir, 'scope.txt'), 'utf-8').trim().split('\n');
  assert.equal(scope.length, 8);
  assert.ok(scope.includes('StatefulSet|default|jaeger'));
  assert.ok(scope.includes('Deployment|ingress-nginx|ingress-nginx-controller'));
  assert.ok(!scope.some((line) => line.includes('property-service')));

  const plan = JSON.parse(fs.readFileSync(path.join(dir, 'scope-plan.json'), 'utf-8'));
  assert.equal(plan.environment, 'dev');
  assert.ok(plan.phases.length >= 2);
  assert.ok(plan.services.every((service) => service.selector.includes('=')));

  const restarts = fs.readFileSync(path.join(dir, 'restart-deployments.txt'), 'utf-8').trim();
  assert.ok(!restarts.includes('ingress-nginx-controller'));
});

test('scope-plan.json has exactly the shape the deploy action jq-queries', () => {
  const { code, dir } = runCli(devDocuments(), 'dev', allowedServices('dev').join(','));
  assert.equal(code, 0);
  const plan = JSON.parse(fs.readFileSync(path.join(dir, 'scope-plan.json'), 'utf-8'));

  // .github/actions/deploy-k8s-resources/action.yml reads these paths and nothing else.
  // If a rename here silently breaks a jq query, the lane applies nothing and reports
  // success — so the contract is asserted rather than assumed.
  //   jq '.phases | length'
  //   jq ".phases[$phase].services[]"      / jq ".phases[$phase].note"
  //   jq '.services[] | select(.name == $s) | .selector'
  //   jq '.services[] | select(.name == $s) | .workloads[] | .kind + "|" + .namespace + "|" + .name'
  assert.ok(Array.isArray(plan.phases) && plan.phases.length > 0);
  for (const phase of plan.phases) {
    assert.ok(Array.isArray(phase.services) && phase.services.length > 0);
    assert.equal(typeof phase.note, 'string');
  }
  assert.ok(Array.isArray(plan.services));
  for (const service of plan.services) {
    assert.equal(typeof service.name, 'string');
    assert.match(service.selector, /^[^=]+=[^=]+$/);
    assert.ok(Array.isArray(service.workloads));
    for (const workload of service.workloads) {
      assert.ok(['StatefulSet', 'Deployment', 'DaemonSet'].includes(workload.kind));
      assert.equal(typeof workload.namespace, 'string');
      assert.equal(typeof workload.name, 'string');
    }
  }

  // Every phase entry must name a service the lane can then look a selector up for.
  const known = new Set(plan.services.map((service) => service.name));
  for (const phase of plan.phases) {
    for (const name of phase.services) {
      assert.ok(known.has(name), `phase names '${name}', which has no selector`);
    }
  }
});

test('CLI exits 1 only for real drift, and names the cause', () => {
  const documents = devDocuments();
  documents.push(IDENTITY_ONLY('Deployment', 'messaging-service', { app: 'messaging-service' }));
  const { code } = runCli(documents, 'dev', allowedServices('dev').join(','));
  assert.equal(code, 1);
});

// ── Fixture drift guard ─────────────────────────────────────────────────────────────────

test('the committed fixture still matches the live hetzner/dev render', (t) => {
  let live;
  try {
    live = execFileSync('kustomize', ['build', 'infra/k8s/hetzner/dev', '--enable-alpha-plugins'], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    t.skip('kustomize not on PATH — the live render is checked by pnpm run infra:validate');
    return;
  }

  const identity = (document) =>
    [
      document.kind,
      document.metadata?.namespace ?? 'default',
      document.metadata?.name,
      document.metadata?.labels?.app ?? '',
      document.metadata?.labels?.['app.kubernetes.io/name'] ?? '',
    ].join('|');

  const liveSet = loadYamlDocuments(live).map(identity).sort();
  const fixtureSet = devDocuments().map(identity).sort();
  assert.deepEqual(
    fixtureSet,
    liveSet,
    'tools/infra/fixtures/hetzner-dev.manifests.yaml is stale — regenerate it from `kustomize build infra/k8s/hetzner/dev`',
  );
});
