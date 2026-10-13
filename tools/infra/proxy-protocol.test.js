'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  findProxyProtocolProblems,
  LB_ANNOTATION,
  HOSTNAME_ANNOTATION,
  PRIVATE_IP_ANNOTATION,
  CIDR_KEY,
  NGINX_KEY,
} = require('./proxy-protocol');

const service = (annotations, spec = {}) => ({
  kind: 'Service',
  metadata: { name: 'ingress-nginx-controller', annotations },
  spec,
});

const GOOD_LB = {
  [LB_ANNOTATION]: 'true',
  [HOSTNAME_ANNOTATION]: 'lb.example.invalid',
  [PRIVATE_IP_ANNOTATION]: 'true',
};
const GOOD_SPEC = { externalTrafficPolicy: 'Local' };
const GOOD_CM = { [NGINX_KEY]: 'true', [CIDR_KEY]: '10.0.0.0/16' };

const configMap = (data) => ({
  kind: 'ConfigMap',
  metadata: { name: 'ingress-nginx-controller' },
  data,
});

test('hetzner: both on with a hostname passes', () => {
  const docs = [service(GOOD_LB, GOOD_SPEC), configMap(GOOD_CM)];
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

test('hetzner: both on without a hostname fails', () => {
  const lb = { ...GOOD_LB, [HOSTNAME_ANNOTATION]: undefined };
  const docs = [service(lb, GOOD_SPEC), configMap(GOOD_CM)];
  const problems = findProxyProtocolProblems(docs, { provider: 'hetzner' });
  assert.equal(problems.length, 1);
  assert.match(problems[0].headline, /hostname/);
});

test('hetzner: a missing Service fails', () => {
  const problems = findProxyProtocolProblems([configMap({ [NGINX_KEY]: 'true' })], {
    provider: 'hetzner',
  });
  assert.match(problems[0].headline, /Service missing/);
});

test('hetzner: both resources missing fails', () => {
  const problems = findProxyProtocolProblems([], { provider: 'hetzner' });
  assert.match(problems[0].headline, /Service and ConfigMap missing/);
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

const hetznerProblems = (lb, spec, cm) =>
  findProxyProtocolProblems([service(lb, spec), configMap(cm)], { provider: 'hetzner' });

test('hetzner: a missing proxy-real-ip-cidr fails', () => {
  const problems = hetznerProblems(GOOD_LB, GOOD_SPEC, { [NGINX_KEY]: 'true' });
  assert.match(problems[0].headline, /any peer is trusted/);
});

test('hetzner: proxy-real-ip-cidr 0.0.0.0/0 fails, also inside a list', () => {
  for (const cidr of ['0.0.0.0/0', '10.0.0.0/16, 0.0.0.0/0', '::/0']) {
    const problems = hetznerProblems(GOOD_LB, GOOD_SPEC, { ...GOOD_CM, [CIDR_KEY]: cidr });
    assert.match(problems[0].headline, /any peer is trusted/, cidr);
  }
});

test('hetzner: no private IP or a Cluster traffic policy fails', () => {
  const noPrivate = { ...GOOD_LB, [PRIVATE_IP_ANNOTATION]: undefined };
  assert.match(hetznerProblems(noPrivate, GOOD_SPEC, GOOD_CM)[0].headline, /private LB/);
  assert.match(
    hetznerProblems(GOOD_LB, { externalTrafficPolicy: 'Cluster' }, GOOD_CM)[0].headline,
    /private LB/,
  );
});
