'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { findPinnableImages, pinManifests, pin, splitDocuments } = require('./pin-image-digests');

const PREFIX = 'ghcr.io/o/r/';
const WEB = `${PREFIX}cribstop-web:dev`;
const API = `${PREFIX}property-service:dev`;
const OPS = `${PREFIX}ops-tool:dev`;
const DB = `${PREFIX}postgres-postgis-pgvector:dev`;
const digestOf = (char) => `sha256:${char.repeat(64)}`;
const DIGESTS = { [WEB]: digestOf('a'), [API]: digestOf('b'), [OPS]: digestOf('c') };
// The format of restart-deployments.txt: the Deployments this run applies.
const IN_SCOPE = new Set(['default|cribstop-web', 'default|property-service']);

// The shape `kustomize build` writes: one document per resource, `kind:` at column 0.
const MANIFESTS = [
  'apiVersion: v1',
  'data:',
  '  note: |',
  '    kind: Deployment',
  `    image: ${WEB}`,
  'kind: ConfigMap',
  'metadata:',
  '  name: notes',
  '---',
  'apiVersion: apps/v1',
  'kind: Deployment',
  'metadata:',
  '  labels:',
  '    name: not-the-resource-name',
  '  name: cribstop-web',
  'spec:',
  '  template:',
  '    metadata:',
  '      name: not-the-resource-name',
  '    spec:',
  '      containers:',
  `      - image: ${WEB}`,
  '        imagePullPolicy: Always',
  '        name: nextjs',
  '---',
  'apiVersion: apps/v1',
  'kind: Deployment',
  'metadata:',
  '  name: property-service',
  '  namespace: default',
  'spec:',
  '  template:',
  '    spec:',
  '      containers:',
  '      - name: api',
  `        image: "${API}"`,
  '      - image: registry.k8s.io/pause:3.9',
  '        name: sidecar',
  '      initContainers:',
  `      - image: ${API}`,
  '        name: migrate',
  '---',
  'apiVersion: apps/v1',
  'kind: Deployment',
  'metadata:',
  '  name: ops-tool',
  '  namespace: ops',
  'spec:',
  '  template:',
  '    spec:',
  '      containers:',
  `      - image: ${OPS}`,
  '        name: ops',
  '---',
  'apiVersion: apps/v1',
  'kind: StatefulSet',
  'metadata:',
  '  name: postgres',
  'spec:',
  '  template:',
  '    spec:',
  '      containers:',
  `      - image: ${DB}`,
  '        name: postgres',
  '',
].join('\n');

test('reads kind, name and namespace of each document', () => {
  const ids = splitDocuments(MANIFESTS).map((d) => `${d.kind}|${d.namespace}|${d.name}`);
  assert.deepEqual(ids, [
    'ConfigMap|default|notes',
    'Deployment|default|cribstop-web',
    'Deployment|default|property-service',
    'Deployment|ops|ops-tool',
    'StatefulSet|default|postgres',
  ]);
});

test('finds first-party tag references in the in-scope Deployments only', () => {
  assert.deepEqual(findPinnableImages(MANIFESTS, { prefix: PREFIX, deployments: IN_SCOPE }), [
    WEB,
    API,
  ]);
});

test('without a scope it finds every Deployment and no other kind', () => {
  assert.deepEqual(findPinnableImages(MANIFESTS, { prefix: PREFIX }), [WEB, OPS, API]);
});

test('pins every in-scope reference and keeps the tag', () => {
  const { text, pinned } = pinManifests(MANIFESTS, {
    prefix: PREFIX,
    deployments: IN_SCOPE,
    digests: DIGESTS,
  });
  assert.equal(pinned, 3);
  assert.ok(text.includes(`      - image: ${WEB}@${digestOf('a')}\n`));
  assert.ok(text.includes(`        image: "${API}@${digestOf('b')}"\n`));
  assert.ok(text.includes(`      - image: ${API}@${digestOf('b')}\n`));
});

test('changes no other line', () => {
  const { text } = pinManifests(MANIFESTS, {
    prefix: PREFIX,
    deployments: IN_SCOPE,
    digests: DIGESTS,
  });
  const before = MANIFESTS.split('\n');
  const after = text.split('\n');
  assert.equal(after.length, before.length);
  assert.equal(before.filter((line, i) => line !== after[i]).length, 3);
  // The out-of-scope Deployment, the StatefulSet, the upstream image and the ConfigMap text
  // keep their value.
  assert.ok(text.includes(`      - image: ${OPS}\n`));
  assert.ok(text.includes(`      - image: ${DB}\n`));
  assert.ok(text.includes('      - image: registry.k8s.io/pause:3.9\n'));
  assert.ok(text.includes(`    image: ${WEB}\n`));
});

test('an empty scope pins nothing', () => {
  const options = { prefix: PREFIX, deployments: new Set() };
  assert.deepEqual(findPinnableImages(MANIFESTS, options), []);
  const { text, pinned } = pinManifests(MANIFESTS, { ...options, digests: {} });
  assert.equal(pinned, 0);
  assert.equal(text, MANIFESTS);
});

test('a second run changes nothing', () => {
  const first = pinManifests(MANIFESTS, { prefix: PREFIX, digests: DIGESTS });
  assert.deepEqual(findPinnableImages(first.text, { prefix: PREFIX }), []);
  const second = pinManifests(first.text, { prefix: PREFIX, digests: {} });
  assert.equal(second.pinned, 0);
  assert.equal(second.text, first.text);
});

test('keeps CRLF line ends', () => {
  const crlf = MANIFESTS.replace(/\n/g, '\r\n');
  const { text, pinned } = pinManifests(crlf, {
    prefix: PREFIX,
    deployments: IN_SCOPE,
    digests: DIGESTS,
  });
  assert.equal(pinned, 3);
  assert.ok(text.includes(`      - image: ${WEB}@${digestOf('a')}\r\n`));
});

test('refuses a missing or malformed digest', () => {
  assert.throws(() => pinManifests(MANIFESTS, { prefix: PREFIX, digests: { [WEB]: 'x' } }));
  assert.throws(() =>
    pinManifests(MANIFESTS, { prefix: PREFIX, digests: { ...DIGESTS, [API]: 'sha256:short' } }),
  );
});

test('pin resolves each in-scope reference once', async () => {
  const calls = [];
  const result = await pin(MANIFESTS, {
    prefix: PREFIX,
    deployments: IN_SCOPE,
    resolveDigest: async (ref) => {
      calls.push(ref);
      return DIGESTS[ref];
    },
  });
  assert.deepEqual(calls, [WEB, API]);
  assert.equal(result.pinned, 3);
  assert.deepEqual(result.digests, { [WEB]: DIGESTS[WEB], [API]: DIGESTS[API] });
});

test('an image that is not in the registry does not stop an out-of-scope Deployment', async () => {
  const result = await pin(MANIFESTS, {
    prefix: PREFIX,
    deployments: IN_SCOPE,
    delayMs: 0,
    resolveDigest: async (ref) => {
      if (ref === OPS) throw new Error('manifest request returned 404');
      return DIGESTS[ref];
    },
  });
  assert.equal(result.pinned, 3);
});

test('pin tries a failed lookup again', async () => {
  let calls = 0;
  const result = await pin(MANIFESTS, {
    prefix: PREFIX,
    deployments: IN_SCOPE,
    delayMs: 0,
    resolveDigest: async (ref) => {
      calls += 1;
      if (calls === 1) throw new Error('registry returned 503');
      return DIGESTS[ref];
    },
  });
  assert.equal(result.pinned, 3);
});

test('pin fails when one in-scope digest does not resolve', async () => {
  await assert.rejects(
    pin(MANIFESTS, {
      prefix: PREFIX,
      deployments: IN_SCOPE,
      delayMs: 0,
      resolveDigest: async (ref) => {
        if (ref === API) throw new Error('manifest request returned 404');
        return DIGESTS[ref];
      },
    }),
    /property-service:dev: manifest request returned 404/,
  );
});

test('pin fails when the registry returns a value that is not a digest', async () => {
  await assert.rejects(
    pin(MANIFESTS, { prefix: PREFIX, delayMs: 0, resolveDigest: async () => 'latest' }),
    /registry returned digest "latest"/,
  );
});
