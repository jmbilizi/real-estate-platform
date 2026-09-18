'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { findChangedValues, stringDataEntries } = require('./check-staged-secrets');
const { PLACEHOLDER } = require('./secret-keys');

const HEAD = [
  'apiVersion: v1',
  'kind: Secret',
  'metadata:',
  '  name: alpha-secret',
  'stringData:',
  `  ALPHA_ONE_PASSWORD: ${PLACEHOLDER}`,
  '  auth: admin:$2y$10$committeddefault',
  '',
].join('\n');

function staged(replacements) {
  return Object.entries(replacements).reduce((text, [from, to]) => text.replace(from, to), HEAD);
}

test('flattens stringData across documents and keys it by secret name', () => {
  const { entries, parsed } = stringDataEntries(HEAD);
  assert.equal(parsed, true);
  assert.equal(entries.get('alpha-secret.ALPHA_ONE_PASSWORD'), PLACEHOLDER);
  assert.equal(entries.get('alpha-secret.auth'), 'admin:$2y$10$committeddefault');
});

test('a data block is read too, decoded, so the sentinel rule applies to it', () => {
  const withData = [
    'apiVersion: v1',
    'kind: Secret',
    'metadata:',
    '  name: gamma-secret',
    'data:',
    `  ALREADY_BASE64: ${Buffer.from(PLACEHOLDER).toString('base64')}`,
    '',
  ].join('\n');
  const { entries } = stringDataEntries(withData);
  assert.equal(entries.get('gamma-secret.data.ALREADY_BASE64'), PLACEHOLDER);
  assert.deepEqual(findChangedValues('gamma.secret.yaml', withData, null), []);
});

test('a real credential hidden in a data block is refused', () => {
  const withData = [
    'apiVersion: v1',
    'kind: Secret',
    'metadata:',
    '  name: gamma-secret',
    'data:',
    `  ALREADY_BASE64: ${Buffer.from('real-production-password').toString('base64')}`,
    '',
  ].join('\n');
  const findings = findChangedValues('gamma.secret.yaml', withData, null);
  assert.deepEqual(
    findings.map((finding) => finding.field),
    ['gamma-secret.data.ALREADY_BASE64'],
  );
});

test('a manifest that does not parse fails closed', () => {
  const { entries, parsed } = stringDataEntries('stringData: [');
  assert.equal(parsed, false);
  assert.equal(entries.size, 0);

  const findings = findChangedValues('alpha.secret.yaml', 'stringData: [', HEAD);
  assert.equal(findings.length, 1);
  assert.match(findings[0].reason, /does not parse/);
});

test('an absent path at a revision is not a parse failure', () => {
  const { entries, parsed } = stringDataEntries(null);
  assert.equal(parsed, true);
  assert.equal(entries.size, 0);
});

test('an unchanged manifest passes, including a committed non-placeholder default', () => {
  assert.deepEqual(findChangedValues('alpha.secret.yaml', HEAD, HEAD), []);
});

test('a hand-edited placeholder is refused', () => {
  const findings = findChangedValues(
    'alpha.secret.yaml',
    staged({ [PLACEHOLDER]: 'real-production-password' }),
    HEAD,
  );
  assert.deepEqual(
    findings.map((finding) => finding.field),
    ['alpha-secret.ALPHA_ONE_PASSWORD'],
  );
  assert.match(findings[0].reason, /committed value was changed/);
});

test('a changed committed default is refused too', () => {
  const findings = findChangedValues(
    'alpha.secret.yaml',
    staged({ 'admin:$2y$10$committeddefault': 'admin:$2y$10$rotated' }),
    HEAD,
  );
  assert.deepEqual(
    findings.map((finding) => finding.field),
    ['alpha-secret.auth'],
  );
});

test('a new key is allowed only with the placeholder', () => {
  const withPlaceholder = `${HEAD}  NEW_KEY: ${PLACEHOLDER}\n`;
  assert.deepEqual(findChangedValues('alpha.secret.yaml', withPlaceholder, HEAD), []);

  const withValue = `${HEAD}  NEW_KEY: a-real-value\n`;
  const findings = findChangedValues('alpha.secret.yaml', withValue, HEAD);
  assert.deepEqual(
    findings.map((finding) => finding.field),
    ['alpha-secret.NEW_KEY'],
  );
  assert.match(findings[0].reason, /committed with the placeholder/);
});

test('a brand new manifest must carry placeholders only', () => {
  const findings = findChangedValues('alpha.secret.yaml', HEAD, null);
  assert.deepEqual(
    findings.map((finding) => finding.field),
    ['alpha-secret.auth'],
  );
});

test('the repository secret manifests pass the guard against themselves', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { SECRETS_DIR } = require('./secret-keys');
  for (const file of fs.readdirSync(SECRETS_DIR)) {
    const text = fs.readFileSync(path.join(SECRETS_DIR, file), 'utf-8');
    assert.deepEqual(findChangedValues(file, text, text), []);
  }
});
