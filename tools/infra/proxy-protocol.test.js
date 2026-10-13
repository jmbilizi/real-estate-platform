'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { findProxyProtocolProblems, LB_ANNOTATION, NGINX_KEY } = require('./proxy-protocol');

const service = (annotations) => ({
  kind: 'Service',
  metadata: { name: 'ingress-nginx-controller', annotations },
});
const configMap = (data) => ({
  kind: 'ConfigMap',
  metadata: { name: 'ingress-nginx-controller' },
  data,
});

test('hetzner: both on passes', () => {
  const docs = [service({ [LB_ANNOTATION]: 'true' }), configMap({ [NGINX_KEY]: 'true' })];
  assert.deepEqual(findProxyProtocolProblems(docs, { provider: 'hetzner' }), []);
});

test('hetzner: both off passes (rollback state)', () => {
  const docs = [service({}), configMap({ 'use-forwarded-headers': 'false' })];
  assert.deepEqual(findProxyProtocolProblems(docs, { provider: 'hetzner' }), []);
});

test('hetzner: load balancer only fails', () => {
  const docs = [service({ [LB_ANNOTATION]: 'true' }), configMap({})];
  const problems = findProxyProtocolProblems(docs, { provider: 'hetzner' });
  assert.equal(problems.length, 1);
  assert.match(problems[0].headline, /disagree/);
});

test('hetzner: nginx only fails', () => {
  const docs = [service({}), configMap({ [NGINX_KEY]: 'true' })];
  assert.equal(findProxyProtocolProblems(docs, { provider: 'hetzner' }).length, 1);
});

test('hetzner: a missing Service counts as off', () => {
  const docs = [configMap({ [NGINX_KEY]: 'true' })];
  assert.equal(findProxyProtocolProblems(docs, { provider: 'hetzner' }).length, 1);
});

test('local provider: both off passes', () => {
  assert.deepEqual(
    findProxyProtocolProblems([service({}), configMap({})], { provider: 'podman' }),
    [],
  );
});

test('local provider: either side on fails', () => {
  const nginxOnly = [service({}), configMap({ [NGINX_KEY]: 'true' })];
  const lbOnly = [service({ [LB_ANNOTATION]: 'true' }), configMap({})];
  assert.equal(findProxyProtocolProblems(nginxOnly, { provider: 'podman' }).length, 1);
  assert.equal(findProxyProtocolProblems(lbOnly, { provider: 'podman' }).length, 1);
});
