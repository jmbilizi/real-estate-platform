'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseImageRef, fetchRegistryDigest, decide } = require('./deployment-image-changed');

const PREFIX = 'ghcr.io/o/r/';
const IMAGE = `${PREFIX}api-gateway:dev`;
const DIGEST = 'sha256:aaa';
const deployment = { spec: { template: { spec: { containers: [{ image: IMAGE }] } } } };
const pod = (imageID) => ({
  metadata: { name: 'p1' },
  status: { phase: 'Running', containerStatuses: [{ image: IMAGE, imageID }] },
});
const resolveDigest = async () => DIGEST;

test('parseImageRef splits registry, repository and tag', () => {
  assert.deepEqual(parseImageRef(IMAGE), {
    registry: 'ghcr.io',
    repository: 'o/r/api-gateway',
    tag: 'dev',
  });
  assert.equal(parseImageRef('x/y@sha256:1'), null);
});

test('skips when every running pod uses the registry digest', async () => {
  const r = await decide({
    deployment,
    pods: { items: [pod(`ghcr.io/o/r/api-gateway@${DIGEST}`)] },
    prefix: PREFIX,
    resolveDigest,
  });
  assert.equal(r.restart, false);
});

test('restarts when a pod runs an older digest', async () => {
  const r = await decide({
    deployment,
    pods: { items: [pod('ghcr.io/o/r/api-gateway@sha256:old')] },
    prefix: PREFIX,
    resolveDigest,
  });
  assert.equal(r.restart, true);
});

test('restarts when the registry probe fails', async () => {
  const r = await decide({
    deployment,
    pods: { items: [pod(`ghcr.io/o/r/api-gateway@${DIGEST}`)] },
    prefix: PREFIX,
    resolveDigest: async () => {
      throw new Error('boom');
    },
  });
  assert.equal(r.restart, true);
  assert.match(r.reason, /probe failed/);
});

test('restarts when no pod runs or the image is third party', async () => {
  assert.equal(
    (await decide({ deployment, pods: { items: [] }, prefix: PREFIX, resolveDigest })).restart,
    true,
  );
  assert.equal(
    (await decide({ deployment, pods: { items: [pod('x')] }, prefix: 'other/', resolveDigest }))
      .restart,
    true,
  );
});

test('restarts when a pod has no imageID', async () => {
  const r = await decide({ deployment, pods: { items: [pod('')] }, prefix: PREFIX, resolveDigest });
  assert.equal(r.restart, true);
});

test('fetchRegistryDigest reads the digest header and rejects bad responses', async () => {
  const ok = async (url) =>
    url.includes('/token')
      ? { ok: true, json: async () => ({ token: 't' }) }
      : { ok: true, headers: { get: (k) => (k === 'docker-content-digest' ? DIGEST : null) } };
  assert.equal(await fetchRegistryDigest(IMAGE, ok), DIGEST);
  await assert.rejects(fetchRegistryDigest(IMAGE, async () => ({ ok: false, status: 403 })));
});
