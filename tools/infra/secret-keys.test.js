'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { deriveSecretKeys, envVarForKey, groupByFile, PLACEHOLDER } = require('./secret-keys');
const { renderEnvExample } = require('./generate-env-example');

const FIXTURES = path.join(__dirname, 'fixtures/secret-keys');
const fixtureOptions = { secretsDir: FIXTURES };

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('derives one record per stringData key across every manifest', () => {
  const records = deriveSecretKeys(fixtureOptions);
  assert.deepEqual(
    records.map((record) => `${record.file}:${record.key}`),
    [
      'alpha.secret.yaml:ALPHA_ONE_PASSWORD',
      'alpha.secret.yaml:ALPHA_TWO_PASSWORD',
      'beta.secret.yaml:BETA_PASSWORD',
      'beta.secret.yaml:auth',
    ],
  );
});

test('a manifest with no stringData block contributes no keys', () => {
  const records = deriveSecretKeys(fixtureOptions);
  assert.equal(
    records.some((record) => record.file === 'gamma.secret.yaml'),
    false,
  );
});

test('a multi-document manifest contributes every document', () => {
  const records = deriveSecretKeys(fixtureOptions).filter(
    (record) => record.file === 'beta.secret.yaml',
  );
  assert.deepEqual(
    records.map((record) => record.secretName),
    ['beta-secret', 'beta-basic-auth-secret'],
  );
});

test('the sentinel is not a filter, so a non-placeholder value stays injectable', () => {
  const auth = deriveSecretKeys(fixtureOptions).find((record) => record.key === 'auth');
  assert.ok(auth, 'the auth key must be derived');
  assert.notEqual(auth.value, PLACEHOLDER);
});

test('a SCREAMING_SNAKE key becomes its own variable name', () => {
  assert.equal(envVarForKey('postgres-secret', 'POSTGRES_SA_PASSWORD'), 'POSTGRES_SA_PASSWORD');
});

test('a generic key is qualified with the secret name, so it cannot collide in process.env', () => {
  assert.equal(envVarForKey('jaeger-secret', 'auth'), 'JAEGER_AUTH');
  assert.equal(envVarForKey('beta-basic-auth-secret', 'auth'), 'BETA_BASIC_AUTH_AUTH');
});

test('the real repository manifests derive with no duplicate variable names', () => {
  const records = deriveSecretKeys();
  const names = records.map((record) => record.envVar);
  assert.ok(records.length > 0, 'the repository must declare secret keys');
  assert.equal(new Set(names).size, names.length);
});

test('groupByFile keeps the derivation order', () => {
  const groups = groupByFile(deriveSecretKeys(fixtureOptions));
  assert.deepEqual([...groups.keys()], ['alpha.secret.yaml', 'beta.secret.yaml']);
});

test('the rendered .env.example lists every variable and no value', () => {
  const records = deriveSecretKeys(fixtureOptions);
  const rendered = renderEnvExample(records);
  for (const record of records) {
    assert.match(rendered, new RegExp(`^${record.envVar}=$`, 'm'));
  }
  assert.equal(rendered.includes('admin:$2y$10$notarealhash'), false);
  assert.equal(rendered.includes(`=${PLACEHOLDER}`), false);
});

test('rendering .env.example twice produces the same bytes', () => {
  const records = deriveSecretKeys(fixtureOptions);
  assert.equal(renderEnvExample(records), renderEnvExample(records));
});

test('the generator is idempotent on disk', () => {
  const dir = tempDir('env-example-');
  const target = path.join(dir, 'env-example-output');
  try {
    const rendered = renderEnvExample(deriveSecretKeys(fixtureOptions));
    fs.writeFileSync(target, rendered);
    const first = fs.readFileSync(target, 'utf-8');
    fs.writeFileSync(target, renderEnvExample(deriveSecretKeys(fixtureOptions)));
    assert.equal(fs.readFileSync(target, 'utf-8'), first);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
