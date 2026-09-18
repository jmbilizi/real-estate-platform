'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { deriveSecretKeys } = require('./secret-keys');
const {
  ensureLocalSecretOverlay,
  selectOverrides,
  renderPatch,
  describeOverrides,
} = require('./local-secret-overlay');

const FIXTURES = path.join(__dirname, 'fixtures/secret-keys');
const fixtureOptions = { secretsDir: FIXTURES };

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('process.loadEnvFile lets the real environment win, which AC 3 depends on', () => {
  // Guards the Node behaviour the override rule is built on, so a runtime upgrade that reversed it
  // would fail here rather than silently inject the wrong value into a cluster Secret.
  const dir = tempDir('load-env-');
  const file = path.join(dir, 'probe');
  const name = 'CRIBSTOP_LOAD_ENV_PROBE';
  fs.writeFileSync(file, `${name}=from-file\n`);
  process.env[name] = 'from-shell';
  try {
    process.loadEnvFile(file);
    assert.equal(process.env[name], 'from-shell');
  } finally {
    delete process.env[name];
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an unset or empty variable is not an override', () => {
  const records = deriveSecretKeys(fixtureOptions);
  const overrides = selectOverrides(records, { ALPHA_TWO_PASSWORD: '', BETA_PASSWORD: 'supplied' });
  assert.deepEqual(
    overrides.map((record) => record.key),
    ['BETA_PASSWORD'],
  );
});

test('a patch carries only the supplied keys and quotes an awkward value', () => {
  const records = deriveSecretKeys(fixtureOptions).filter(
    (record) => record.secretName === 'alpha-secret',
  );
  const env = { ALPHA_ONE_PASSWORD: '12345' };
  const patch = renderPatch('alpha-secret', selectOverrides(records, env), env);
  assert.match(patch, /name: alpha-secret/);
  assert.match(patch, /ALPHA_ONE_PASSWORD: '12345'/);
  assert.equal(patch.includes('ALPHA_TWO_PASSWORD'), false);
});

test('no supplied key generates no overlay at all', () => {
  const dir = path.join(tempDir('overlay-'), 'secrets');
  try {
    const result = ensureLocalSecretOverlay({
      env: {},
      dir,
      records: deriveSecretKeys(fixtureOptions),
    });
    assert.equal(result.dir, null);
    assert.equal(fs.existsSync(dir), false);
    assert.match(describeOverrides(result), /No local secret overrides/);
  } finally {
    fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  }
});

test('one supplied key writes one patch and chains to the committed overlay', () => {
  const parent = tempDir('overlay-');
  const dir = path.join(parent, 'secrets');
  try {
    const result = ensureLocalSecretOverlay({
      env: { BETA_PASSWORD: 'supplied' },
      dir,
      records: deriveSecretKeys(fixtureOptions),
    });
    assert.equal(result.dir, dir);
    assert.deepEqual(result.overriddenKeys, ['BETA_PASSWORD']);
    assert.deepEqual(fs.readdirSync(dir).sort(), ['beta-secret.secret.yaml', 'kustomization.yaml']);

    const kustomization = fs.readFileSync(path.join(dir, 'kustomization.yaml'), 'utf-8');
    assert.match(kustomization, /resources:\n {2}- \.\.\/\.\.\/local/);
    assert.match(kustomization, /- path: beta-secret\.secret\.yaml/);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('a later run with no supplied key removes the stale overlay', () => {
  const parent = tempDir('overlay-');
  const dir = path.join(parent, 'secrets');
  const records = deriveSecretKeys(fixtureOptions);
  try {
    ensureLocalSecretOverlay({ env: { BETA_PASSWORD: 'supplied' }, dir, records });
    assert.equal(fs.existsSync(dir), true);
    ensureLocalSecretOverlay({ env: {}, dir, records });
    assert.equal(fs.existsSync(dir), false);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('the summary names keys and a count, never a value', () => {
  const parent = tempDir('overlay-');
  const dir = path.join(parent, 'secrets');
  try {
    const result = ensureLocalSecretOverlay({
      env: { BETA_PASSWORD: 'a-real-looking-secret' },
      dir,
      records: deriveSecretKeys(fixtureOptions),
    });
    const summary = describeOverrides(result);
    assert.match(summary, /Overriding 1 of 4 keys: BETA_PASSWORD/);
    assert.equal(summary.includes('a-real-looking-secret'), false);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
