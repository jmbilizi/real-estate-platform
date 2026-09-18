'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  main,
  checkSecretDrift,
  parseActionSubstitutions,
  parseWorkflowEnvKeys,
  ACTION_PATH,
  WORKFLOW_PATH,
} = require('./secret-drift');
const { deriveSecretKeys } = require('./secret-keys');
const { renderEnvExample } = require('./generate-env-example');

const KEY_FIXTURES = path.join(__dirname, 'fixtures/secret-keys');
const DRIFT_FIXTURES = path.join(__dirname, 'fixtures/secret-drift');

/**
 * Point the gate at the fixture manifests, a fixture action and a fixture workflow, with a
 * `.env.example` rendered from those same manifests so the third relation stays clean and each
 * assertion names the relation it exercises.
 */
function fixtureOptions(actionFixture) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-drift-'));
  const envExamplePath = path.join(dir, 'env-example');
  fs.writeFileSync(
    envExamplePath,
    renderEnvExample(deriveSecretKeys({ secretsDir: KEY_FIXTURES })),
  );
  return {
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
    options: {
      secretsDir: KEY_FIXTURES,
      actionPath: path.join(DRIFT_FIXTURES, actionFixture),
      workflowPath: path.join(DRIFT_FIXTURES, 'workflow-ok.yml'),
      envExamplePath,
    },
  };
}

test('parses every yq secret substitution and ignores the domain family', () => {
  const pairs = parseActionSubstitutions(
    fs.readFileSync(path.join(DRIFT_FIXTURES, 'action-ok.yml'), 'utf-8'),
  );
  assert.deepEqual(pairs, [
    { key: 'ALPHA_ONE_PASSWORD', envVar: 'ALPHA_ONE_PASSWORD' },
    { key: 'ALPHA_TWO_PASSWORD', envVar: 'ALPHA_TWO_PASSWORD' },
    { key: 'BETA_PASSWORD', envVar: 'BETA_PASSWORD' },
    { key: 'auth', envVar: 'BETA_BASIC_AUTH' },
  ]);
});

test('parses the env keys of the workflow step that uses the deploy action', () => {
  const keys = parseWorkflowEnvKeys(
    fs.readFileSync(path.join(DRIFT_FIXTURES, 'workflow-ok.yml'), 'utf-8'),
  );
  assert.equal(keys.has('BETA_BASIC_AUTH'), true);
  assert.equal(keys.has('FIXTURE_DOMAIN'), true);
});

test('an aligned action and workflow report no drift', () => {
  const { options, cleanup } = fixtureOptions('action-ok.yml');
  try {
    assert.deepEqual(checkSecretDrift(options), []);
    assert.equal(main(options), 0);
  } finally {
    cleanup();
  }
});

test('an extra workflow variable is not drift, because the domain family shares that block', () => {
  const { options, cleanup } = fixtureOptions('action-ok.yml');
  try {
    const headlines = checkSecretDrift(options).map((problem) => problem.headline);
    assert.equal(
      headlines.some((headline) => headline.includes('workflow never passes')),
      false,
    );
  } finally {
    cleanup();
  }
});

test('a drifting action exits the gate non-zero and names every disagreement', () => {
  const { options, cleanup } = fixtureOptions('action-drift.yml');
  try {
    const problems = checkSecretDrift(options);
    const byHeadline = new Map(problems.map((problem) => [problem.headline, problem.items]));

    assert.deepEqual(byHeadline.get('Secret manifest keys the deploy action never substitutes'), [
      'ALPHA_TWO_PASSWORD',
      'auth',
    ]);
    assert.deepEqual(
      byHeadline.get('Keys the deploy action substitutes that no secret manifest declares'),
      ['STALE_KEY'],
    );
    assert.deepEqual(
      byHeadline.get('Variables the deploy action reads that the workflow never passes'),
      ['NEVER_PASSED'],
    );
    assert.equal(main(options), 1);
  } finally {
    cleanup();
  }
});

test('a stale .env.example is drift on its own', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-drift-'));
  const envExamplePath = path.join(dir, 'env-example');
  fs.writeFileSync(envExamplePath, '# stale\n');
  try {
    const problems = checkSecretDrift({
      secretsDir: KEY_FIXTURES,
      actionPath: path.join(DRIFT_FIXTURES, 'action-ok.yml'),
      workflowPath: path.join(DRIFT_FIXTURES, 'workflow-ok.yml'),
      envExamplePath,
    });
    assert.deepEqual(
      problems.map((problem) => problem.headline),
      ['.env.example does not match the secret manifests'],
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the repository itself has no secret key drift', () => {
  assert.deepEqual(checkSecretDrift(), []);
});

test('the real action and workflow both parse to a non-empty set', () => {
  const pairs = parseActionSubstitutions(fs.readFileSync(ACTION_PATH, 'utf-8'));
  const keys = parseWorkflowEnvKeys(fs.readFileSync(WORKFLOW_PATH, 'utf-8'));
  assert.ok(pairs.length > 0, 'the deploy action must substitute secret values');
  assert.ok(keys.size > 0, 'the workflow must pass secret values to the deploy action');
});
