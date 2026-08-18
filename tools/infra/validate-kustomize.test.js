const test = require('node:test');
const assert = require('node:assert/strict');

const { findUnmanagedWorkloads, workloadIdentity } = require('./validate-kustomize');

test('uses the app label before the ingress-nginx name label', () => {
  assert.equal(
    workloadIdentity({
      metadata: {
        name: 'controller',
        labels: { app: 'ingress-nginx-controller', 'app.kubernetes.io/name': 'ingress-nginx' },
      },
    }),
    'ingress-nginx-controller',
  );
});

test('accepts jaeger and ingress-nginx workloads from a rendered manifest', () => {
  const manifest = [
    'kind: StatefulSet',
    'metadata:',
    '  name: jaeger',
    '  labels:',
    '    app: jaeger',
    '---',
    'kind: Deployment',
    'metadata:',
    '  name: ingress-nginx-controller',
    '  namespace: ingress-nginx',
    '  labels:',
    '    app.kubernetes.io/name: ingress-nginx',
  ].join('\n');

  assert.deepEqual(findUnmanagedWorkloads(manifest, 'dev'), []);
});

test('reports a workload with no deploy-control entry', () => {
  const manifest = [
    'kind: Deployment',
    'metadata:',
    '  name: unregistered-service',
    '  labels:',
    '    app: unregistered-service',
  ].join('\n');

  assert.deepEqual(findUnmanagedWorkloads(manifest, 'dev'), [
    'Deployment|default|unregistered-service',
  ]);
});
