'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const {
  DISABLED_SERVICES_ENV,
  loadRouteFiles,
  parseRouteFile,
  resolveGatewayRouteProblems,
} = require('./gateway-routes');

const REPO_ROOT = path.resolve(__dirname, '../..');
const BASE_DIR = path.join(REPO_ROOT, 'infra/k8s/base');

function loadYamlDocuments(text) {
  const documents = [];
  yaml.loadAll(text, (document) => {
    if (document) documents.push(document);
  });
  return documents;
}

/**
 * The real base Services and api-gateway Deployment, unreduced.
 *
 * Deliberately NOT `fixtures/hetzner-dev.manifests.yaml`: that fixture is a reduction down
 * to the fields deploy-scope.js reads (identity labels and images), so it carries neither
 * `Service.spec.ports` nor the gateway's container env — precisely the two fields this
 * check resolves against. No overlay patches ports or the route set, so the base is
 * faithful here; the fully-rendered per-environment cross-check is what
 * validate-kustomize.js runs.
 */
function baseDocuments() {
  const documents = [];
  for (const file of fs.readdirSync(path.join(BASE_DIR, 'services'))) {
    documents.push(
      ...loadYamlDocuments(fs.readFileSync(path.join(BASE_DIR, 'services', file), 'utf-8')),
    );
  }
  documents.push(
    ...loadYamlDocuments(
      fs.readFileSync(path.join(BASE_DIR, 'deployments/api-gateway.deployment.yaml'), 'utf-8'),
    ),
  );
  return documents;
}

function realControl() {
  return yaml.load(fs.readFileSync(path.join(REPO_ROOT, 'infra/deploy-control.yaml'), 'utf-8'));
}

function realRouteFiles() {
  return loadRouteFiles();
}

function readRouteFileJson(file) {
  return JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'apps/api-gateway/Configuration/Routes', file), 'utf-8'),
  );
}

/** Deep clone so a test can mutate one environment without leaking into the next. */
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/** Rewrite the rendered api-gateway Deployment's GATEWAY_DISABLED_SERVICES value. */
function withDisabledServices(documents, value) {
  const copy = clone(documents);
  const deployment = copy.find(
    (document) =>
      document.kind === 'Deployment' && document.metadata?.labels?.app === 'api-gateway',
  );
  assert.ok(deployment, 'base manifests must contain the api-gateway Deployment');
  const container = deployment.spec.template.spec.containers[0];
  container.env = (container.env ?? []).filter((entry) => entry.name !== DISABLED_SERVICES_ENV);
  if (value !== null) {
    container.env.push({ name: DISABLED_SERVICES_ENV, value });
  }
  return copy;
}

const SERVICE_DOCS = [
  {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: { name: 'widget-svc', labels: { app: 'widget-service' } },
    spec: { ports: [{ name: 'http', port: 9100 }] },
  },
  {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name: 'api-gateway', labels: { app: 'api-gateway' } },
    spec: {
      template: { spec: { containers: [{ name: 'ocelot', env: [] }] } },
    },
  },
];

const WIDGET_ROUTE_FILE = parseRouteFile('widget-service-routes.json', {
  ServiceName: 'Widget',
  Active: true,
  Routes: [
    {
      UpstreamPathTemplate: '/widget/things',
      DownstreamHostAndPorts: [{ Host: 'widget-svc', Port: 9100 }],
    },
  ],
  SwaggerEndPoints: [
    {
      Key: 'Widget',
      Config: [{ Name: 'Widget', Version: 'v1', Url: 'http://widget-svc:9100/openapi.json' }],
    },
  ],
});

function control({ enabled = true, autoDeploy = true, envAutoDeploy = true } = {}) {
  return {
    global: { auto_deploy: true },
    environments: {
      dev: {
        enabled: true,
        auto_deploy: envAutoDeploy,
        services: {
          'api-gateway': { enabled: true, auto_deploy: true },
          'widget-service': { enabled, auto_deploy: autoDeploy },
        },
      },
    },
  };
}

// ── The historical #22/#71 condition ────────────────────────────────────────────────────

test('reproduces #22/#71: a route file advertising a service the environment will not deploy', () => {
  // Exactly the dev outage: property-service-routes.json ships three routes and a
  // SwaggerEndPoints entry downstream to property-service-svc:3002 while property-service
  // sits gated off in deploy-control, with nothing suppressing the route file.
  const broken = clone(realControl());
  broken.environments.dev.services['property-service'].enabled = false;

  const problems = resolveGatewayRouteProblems({
    routeFiles: realRouteFiles(),
    documents: withDisabledServices(baseDocuments(), null),
    control: broken,
    environment: 'dev',
  });

  assert.equal(problems.length, 1, `expected exactly one problem, got ${JSON.stringify(problems)}`);
  assert.match(problems[0].headline, /advertise/i);
  assert.equal(problems[0].items.length, 1);

  const item = problems[0].items[0];
  // The message must be actionable without opening three files.
  assert.match(item, /property-service-routes\.json/);
  assert.match(item, /"Property"/);
  assert.match(item, /property-service/);
  assert.match(item, /dev/);
  assert.match(item, /enabled: false/);
  assert.match(item, /property-service-svc:3002/);
  // SwaggerEndPoints is what actually produced the 500 — it must be named too.
  assert.match(item, /SwaggerEndPoints/);
});

test('the same condition in test and prod is caught, not only in dev', () => {
  for (const environment of ['test', 'prod']) {
    const problems = resolveGatewayRouteProblems({
      routeFiles: realRouteFiles(),
      documents: withDisabledServices(baseDocuments(), null),
      control: realControl(),
      environment,
    });

    const advertised = problems.find((problem) => /advertise/i.test(problem.headline));
    assert.ok(advertised, `${environment}: expected an advertised-but-not-deployable problem`);
    // account-service and property-service are both enabled: false in test and prod today.
    assert.deepEqual(advertised.items.map((item) => item.split(' ')[0]).sort(), [
      'account-service-routes.json',
      'property-service-routes.json',
    ]);
  }
});

// ── The repository as it ships ──────────────────────────────────────────────────────────

test('every environment passes with the shipped route files and overlays', () => {
  // dev is checked against the rendered fixture; test/prod need their own overlay values,
  // which validate-kustomize supplies from the real render. Here we assert the derivation
  // the overlays are expected to declare.
  const cases = [
    ['dev', ''],
    ['test', 'Account,Property'],
    ['prod', 'Account,Property'],
  ];

  for (const [environment, disabled] of cases) {
    assert.deepEqual(
      resolveGatewayRouteProblems({
        routeFiles: realRouteFiles(),
        documents: withDisabledServices(baseDocuments(), disabled),
        control: realControl(),
        environment,
      }),
      [],
      `${environment} should be clean with ${DISABLED_SERVICES_ENV}="${disabled}"`,
    );
  }
});

// ── Host → deploy-control key resolution is explicit ────────────────────────────────────

test('a downstream host that no rendered Service provides is a failure', () => {
  const routeFile = parseRouteFile('ghost-routes.json', {
    ServiceName: 'Ghost',
    Active: true,
    Routes: [
      { UpstreamPathTemplate: '/ghost', DownstreamHostAndPorts: [{ Host: 'ghost-svc', Port: 1 }] },
    ],
  });

  const problems = resolveGatewayRouteProblems({
    routeFiles: [routeFile],
    documents: SERVICE_DOCS,
    control: control(),
    environment: 'dev',
  });

  assert.equal(problems.length, 1);
  assert.match(problems[0].headline, /no rendered Service/i);
  assert.match(problems[0].items[0], /ghost-svc/);
});

test('a Service with no deploy-control identity label is a failure, not a silent pass', () => {
  // The renamed-service case: the host resolves to a Service, but nothing ties that Service
  // to a deploy-control key, so gating could never be evaluated.
  const documents = clone(SERVICE_DOCS);
  documents[0].metadata.labels = { app: 'renamed-widget' };

  const problems = resolveGatewayRouteProblems({
    routeFiles: [WIDGET_ROUTE_FILE],
    documents,
    control: control(),
    environment: 'dev',
  });

  assert.equal(problems.length, 1);
  assert.match(problems[0].headline, /deploy-control/i);
  assert.match(problems[0].items[0], /widget-svc/);
  assert.match(problems[0].items[0], /renamed-widget/);
});

test('a downstream port the Service does not expose is a failure', () => {
  const routeFile = parseRouteFile('widget-service-routes.json', {
    ServiceName: 'Widget',
    Active: true,
    Routes: [
      {
        UpstreamPathTemplate: '/widget/things',
        DownstreamHostAndPorts: [{ Host: 'widget-svc', Port: 9999 }],
      },
    ],
  });

  const problems = resolveGatewayRouteProblems({
    routeFiles: [routeFile],
    documents: SERVICE_DOCS,
    control: control(),
    environment: 'dev',
  });

  assert.equal(problems.length, 1);
  assert.match(problems[0].headline, /port/i);
  assert.match(problems[0].items[0], /9999/);
});

// ── Gating semantics ────────────────────────────────────────────────────────────────────

test('auto_deploy: false fails only when the environment is on an automated footing', () => {
  const automated = resolveGatewayRouteProblems({
    routeFiles: [WIDGET_ROUTE_FILE],
    documents: SERVICE_DOCS,
    control: control({ autoDeploy: false, envAutoDeploy: true }),
    environment: 'dev',
  });
  assert.equal(automated.length, 1);
  assert.match(automated[0].items[0], /auto_deploy: false/);

  // With the environment itself on manual dispatch, auto_deploy: false says nothing about
  // whether the service is deployed — flagging it would fail test and prod by construction.
  const manual = resolveGatewayRouteProblems({
    routeFiles: [WIDGET_ROUTE_FILE],
    documents: SERVICE_DOCS,
    control: control({ autoDeploy: false, envAutoDeploy: false }),
    environment: 'dev',
  });
  assert.deepEqual(manual, []);
});

test('an inactive route file whose downstream does not resolve is left alone', () => {
  // Deployability cannot be judged without resolving the host, and an inactive file is
  // advertised nowhere, so there is nothing to report — and no host/port noise either.
  const inactive = parseRouteFile('widget-service-routes.json', {
    ServiceName: 'Widget',
    Active: false,
    Routes: [
      {
        UpstreamPathTemplate: '/widget/things',
        DownstreamHostAndPorts: [{ Host: 'ghost-svc', Port: 1 }],
      },
    ],
  });

  assert.deepEqual(
    resolveGatewayRouteProblems({
      routeFiles: [inactive],
      documents: SERVICE_DOCS,
      control: control({ enabled: false }),
      environment: 'dev',
    }),
    [],
  );
});

// ── Active: false is the other way to un-advertise, and is policed the same way ──────────

/**
 * Stakeholder finding, 2026-08-19. There are two switches that stop a route file being
 * advertised — `Active: false` (global, in the route file) and GATEWAY_DISABLED_SERVICES
 * (per-environment, on the Deployment) — and the guard policed only the second. Setting
 * `Active: false` on property-service-routes.json while property-service is deployable in
 * dev produced `hetzner/dev: PASSED`.
 *
 * That is the same defect the over-suppression rule already catches (a deployed service the
 * gateway will not route to) reached through the other switch, and `Active` is the likelier
 * one to be flipped because it sits in the route file itself.
 *
 * The rule is therefore uniform: `Active: false` means "suppressed in every environment",
 * so it is a failure whenever the service is deployable in ANY environment.
 */

function widgetRouteFile(overrides = {}) {
  return parseRouteFile('widget-service-routes.json', {
    ServiceName: 'Widget',
    Active: true,
    Routes: [
      {
        UpstreamPathTemplate: '/widget/things',
        DownstreamHostAndPorts: [{ Host: 'widget-svc', Port: 9100 }],
      },
    ],
    ...overrides,
  });
}

test('reproduces the stakeholder gap: Active: false while the service still deploys', () => {
  const routeFiles = realRouteFiles().map((routeFile) =>
    routeFile.file === 'property-service-routes.json'
      ? parseRouteFile(routeFile.file, {
          ...readRouteFileJson('property-service-routes.json'),
          Active: false,
        })
      : routeFile,
  );

  const problems = resolveGatewayRouteProblems({
    routeFiles,
    documents: withDisabledServices(baseDocuments(), null),
    control: realControl(),
    environment: 'dev',
  });

  assert.equal(problems.length, 1, `expected exactly one problem, got ${JSON.stringify(problems)}`);
  assert.match(problems[0].headline, /Active/);

  const item = problems[0].items[0];
  assert.match(item, /property-service-routes\.json/);
  assert.match(item, /"Property"/);
  assert.match(item, /property-service/);
  // Must name which environments deploy it — dev does, test and prod do not.
  assert.match(item, /dev/);
  assert.doesNotMatch(item, /test/);
});

test('Active: false with the service deployable nowhere passes', () => {
  assert.deepEqual(
    resolveGatewayRouteProblems({
      routeFiles: [widgetRouteFile({ Active: false })],
      documents: SERVICE_DOCS,
      control: control({ enabled: false }),
      environment: 'dev',
    }),
    [],
  );
});

test('a string "true" typo reads as inactive, and the message says so', () => {
  // Both JsonMerger and this parser treat "true" (string), 1, and a missing key as
  // inactive, so a typo strands a service with no divergence to notice. The new rule
  // catches it because the service stays deployable — but the message has to explain that
  // the file reads as inactive, or the author who thought they wrote `true` is lost.
  for (const value of ['true', 1]) {
    const problems = resolveGatewayRouteProblems({
      routeFiles: [widgetRouteFile({ Active: value })],
      documents: SERVICE_DOCS,
      control: control(),
      environment: 'dev',
    });

    assert.equal(problems.length, 1);
    assert.match(problems[0].headline, /Active/);
    assert.match(problems[0].items[0], /not the boolean/i);
    assert.match(problems[0].items[0], new RegExp(JSON.stringify(value)));
  }
});

test('a missing Active key reads as inactive and is reported as such', () => {
  const problems = resolveGatewayRouteProblems({
    routeFiles: [widgetRouteFile({ Active: undefined })],
    documents: SERVICE_DOCS,
    control: control(),
    environment: 'dev',
  });

  assert.equal(problems.length, 1);
  assert.match(problems[0].items[0], /no "Active" key/i);
});

// ── The two switches must not double-report one cause ───────────────────────────────────

test('Active: false plus a GATEWAY_DISABLED_SERVICES entry yields ONE error, not two', () => {
  // Before this rule existed, setting Active: false on Account immediately broke test and
  // prod with a misleading "stale entry" message while dev — the environment that actually
  // deploys it — passed. One cause must produce one error, and it must be the right one.
  const documents = clone(SERVICE_DOCS);
  documents[1].spec.template.spec.containers[0].env = [
    { name: DISABLED_SERVICES_ENV, value: 'Widget' },
  ];

  const problems = resolveGatewayRouteProblems({
    routeFiles: [widgetRouteFile({ Active: false })],
    documents,
    control: control(),
    environment: 'dev',
  });

  assert.equal(problems.length, 1, `expected one problem, got ${JSON.stringify(problems)}`);
  assert.equal(problems[0].items.length, 1);
  assert.match(problems[0].headline, /Active/);
});

test('an inactive route file named in GATEWAY_DISABLED_SERVICES is redundant, not stale', () => {
  // Deployable nowhere, so the Active rule stays quiet — but declaring it in both places is
  // still two mechanisms for one decision, and "stale entry" would misdescribe it.
  const documents = clone(SERVICE_DOCS);
  documents[1].spec.template.spec.containers[0].env = [
    { name: DISABLED_SERVICES_ENV, value: 'Widget' },
  ];

  const problems = resolveGatewayRouteProblems({
    routeFiles: [widgetRouteFile({ Active: false })],
    documents,
    control: control({ enabled: false }),
    environment: 'dev',
  });

  assert.equal(problems.length, 1);
  assert.match(problems[0].items[0], /Widget/);
  assert.match(problems[0].items[0], /one mechanism/i);
  assert.doesNotMatch(problems[0].items[0], /stale/i);
});

// ── GATEWAY_DISABLED_SERVICES must equal the derived set, in both directions ─────────────

test('suppressing a service that IS deployable is a failure too', () => {
  const documents = clone(SERVICE_DOCS);
  documents[1].spec.template.spec.containers[0].env = [
    { name: DISABLED_SERVICES_ENV, value: 'Widget' },
  ];

  const problems = resolveGatewayRouteProblems({
    routeFiles: [WIDGET_ROUTE_FILE],
    documents,
    control: control(),
    environment: 'dev',
  });

  assert.equal(problems.length, 1);
  assert.match(problems[0].headline, new RegExp(DISABLED_SERVICES_ENV));
  assert.match(problems[0].items[0], /Widget/);
});

test('a stale GATEWAY_DISABLED_SERVICES entry naming no route file is a failure', () => {
  const documents = clone(SERVICE_DOCS);
  documents[1].spec.template.spec.containers[0].env = [
    { name: DISABLED_SERVICES_ENV, value: 'Widget,Messaging' },
  ];

  const problems = resolveGatewayRouteProblems({
    routeFiles: [WIDGET_ROUTE_FILE],
    documents,
    control: control({ enabled: false }),
    environment: 'dev',
  });

  assert.equal(problems.length, 1);
  assert.match(problems[0].headline, new RegExp(DISABLED_SERVICES_ENV));
  assert.match(problems[0].items[0], /Messaging/);
});

test('a missing api-gateway Deployment is a failure, not an empty advertisement set', () => {
  const problems = resolveGatewayRouteProblems({
    routeFiles: [WIDGET_ROUTE_FILE],
    documents: [SERVICE_DOCS[0]],
    control: control({ enabled: false }),
    environment: 'dev',
  });

  assert.ok(problems.some((problem) => /api-gateway Deployment/i.test(problem.headline)));
});

// ── Provider overlays with no deploy-control (podman/local) ─────────────────────────────

test('without deploy-control only host resolution is enforced', () => {
  assert.deepEqual(
    resolveGatewayRouteProblems({
      routeFiles: [WIDGET_ROUTE_FILE],
      documents: SERVICE_DOCS,
      control: null,
      environment: 'local',
    }),
    [],
  );

  const problems = resolveGatewayRouteProblems({
    routeFiles: [WIDGET_ROUTE_FILE],
    documents: [SERVICE_DOCS[1]],
    control: null,
    environment: 'local',
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0].headline, /no rendered Service/i);
});

// ── Route file parsing ──────────────────────────────────────────────────────────────────

test('the shipped route files are discovered and fully parsed', () => {
  const files = realRouteFiles();
  assert.deepEqual(files.map((file) => file.file).sort(), [
    'account-service-routes.json',
    'inference-service-routes.json',
    'property-service-routes.json',
  ]);

  const property = files.find((file) => file.file === 'property-service-routes.json');
  assert.equal(property.serviceName, 'Property');
  assert.equal(property.active, true);

  // Three Routes entries plus the SwaggerEndPoints URL, all on property-service-svc:3002.
  assert.equal(property.downstreams.length, 4);
  assert.ok(
    property.downstreams.every(
      (down) => down.host === 'property-service-svc' && down.port === 3002,
    ),
  );
  assert.equal(
    property.downstreams.filter((down) => down.origin.startsWith('SwaggerEndPoints')).length,
    1,
  );
});

test('a SwaggerEndPoints URL with no explicit port resolves to the scheme default', () => {
  const routeFile = parseRouteFile('x.json', {
    ServiceName: 'X',
    Active: true,
    Routes: [],
    SwaggerEndPoints: [{ Key: 'X', Config: [{ Url: 'http://x-svc/openapi.json' }] }],
  });

  assert.deepEqual(
    routeFile.downstreams.map((down) => [down.host, down.port]),
    [['x-svc', 80]],
  );
});
