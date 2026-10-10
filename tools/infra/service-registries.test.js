'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { findRegistryProblems, checkServiceRegistries } = require('./service-registries');

const services = (...names) => Object.fromEntries(names.map((name) => [name, {}]));

function inputs(overrides = {}) {
  return {
    deployControl: {
      environments: {
        dev: { services: services('postgres', 'property-service', 'inference') },
        prod: { services: services('postgres', 'property-service', 'inference') },
      },
    },
    smartConfig: { services: services('postgres', 'property-service', 'inference') },
    skaffoldImages: ['property-service', 'inference-service'],
    nxImages: ['property-service', 'inference-service'],
    routeHosts: [{ file: 'property-service-routes.json', host: 'property-service-svc' }],
    ...overrides,
  };
}

test('agreeing registries report no problem', () => {
  assert.deepEqual(findRegistryProblems(inputs()), []);
});

test('a deploy-control service missing from smart-deployment-config names both files and the envs', () => {
  const problems = findRegistryProblems(
    inputs({ smartConfig: { services: services('postgres', 'inference') } }),
  );
  assert.equal(problems.length, 1);
  assert.match(
    problems[0].headline,
    /deploy-control\.yaml has a service .*smart-deployment-config/,
  );
  assert.deepEqual(problems[0].items, ['property-service (deploy-control: dev, prod)']);
});

test('a smart-deployment-config service missing from deploy-control is reported', () => {
  const problems = findRegistryProblems(
    inputs({
      smartConfig: { services: services('postgres', 'property-service', 'inference', 'jaeger') },
    }),
  );
  assert.equal(problems.length, 1);
  assert.match(
    problems[0].headline,
    /smart-deployment-config\.yaml has a service .*deploy-control/,
  );
  assert.deepEqual(problems[0].items, ['jaeger']);
});

test('a service in only one deploy-control environment still needs a smart entry', () => {
  const problems = findRegistryProblems(
    inputs({
      deployControl: {
        environments: {
          dev: { services: services('postgres', 'property-service', 'inference') },
          test: { services: services('postgres', 'property-service', 'inference', 'jaeger') },
        },
      },
    }),
  );
  assert.deepEqual(problems[0].items, ['jaeger (deploy-control: test)']);
});

test('an Nx image with no skaffold artifact, and the reverse, are reported', () => {
  const missingArtifact = findRegistryProblems(inputs({ skaffoldImages: ['property-service'] }));
  assert.match(missingArtifact[0].headline, /Nx container-build projects with no skaffold/);
  assert.deepEqual(missingArtifact[0].items, ['inference-service']);

  const missingProject = findRegistryProblems(inputs({ nxImages: ['property-service'] }));
  assert.match(missingProject[0].headline, /skaffold\.yaml artifacts with no Nx/);
  assert.deepEqual(missingProject[0].items, ['inference-service']);
});

test('a gateway route host with no deploy-control key is reported', () => {
  const problems = findRegistryProblems(
    inputs({ routeHosts: [{ file: 'x-routes.json', host: 'x-service-svc' }] }),
  );
  assert.match(problems[0].headline, /Gateway route files/);
  assert.match(problems[0].items[0], /x-routes\.json routes to x-service-svc/);
});

test('the real registries agree', () => {
  assert.deepEqual(checkServiceRegistries(), []);
});
