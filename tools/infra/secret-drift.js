#!/usr/bin/env node

/**
 * CI key-drift gate for the secret manifests.
 *
 * The deploy action keeps its hand-written form. This gate asserts that it cannot disagree
 * silently with the manifests or with `.env.example`. Design: #160.
 *
 * Three relations are checked:
 *
 *   R1  Manifest `stringData` keys == the `.stringData.<KEY>` assignment targets in the action.
 *       Both directions. A key added to a manifest with no matching `yq` line would deploy the
 *       committed placeholder to production with no error.
 *
 *   R2  Every `env(<VAR>)` the action reads is present in the workflow `env:` block that feeds it.
 *       One direction only: that block legitimately also carries the ingress-domain variables,
 *       which are a separate substitution family and out of scope here.
 *
 *   R3  `.env.example` matches the derivation.
 *
 * R1 is keyed on the manifest key and R2 on the variable name, because the two are not always
 * equal — the jaeger manifest key is `auth` and CI feeds it from `JAEGER_BASIC_AUTH`. A gate that
 * compared one flat set of names would report that correct wiring as drift.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { deriveSecretKeys } = require('./secret-keys');
const { renderEnvExample, ENV_EXAMPLE_PATH } = require('./generate-env-example');

const workspaceRoot = path.resolve(__dirname, '../..');
const ACTION_PATH = path.join(
  workspaceRoot,
  '.github',
  'actions',
  'deploy-k8s-resources',
  'action.yml',
);
const WORKFLOW_PATH = path.join(workspaceRoot, '.github', 'workflows', 'deploy-k8s-resources.yml');
const ACTION_USES = './.github/actions/deploy-k8s-resources';

/**
 * Parse the action's secret-value substitutions.
 *
 * Matches `yq eval '.stringData.<KEY> = env(<VAR>)'`. The ingress-domain family uses `sed` over
 * `*_DOMAIN_PLACEHOLDER` tokens, so this pattern scopes itself to the secret family with no
 * line-range bookkeeping.
 *
 * @returns {Array<{ key: string, envVar: string }>}
 */
function parseActionSubstitutions(actionText) {
  const pattern = /\.stringData\.([A-Za-z0-9_]+)\s*=\s*env\(([A-Za-z0-9_]+)\)/g;
  const pairs = [];
  const seen = new Set();
  for (const match of actionText.matchAll(pattern)) {
    const signature = `${match[1]}=${match[2]}`;
    if (!seen.has(signature)) {
      seen.add(signature);
      pairs.push({ key: match[1], envVar: match[2] });
    }
  }
  return pairs;
}

/**
 * Read the `env:` keys of every workflow step that uses the deploy action.
 *
 * Parsed as YAML rather than matched with a regex, so a reordered or reindented step cannot make
 * the gate silently see an empty block and pass.
 */
function parseWorkflowEnvKeys(workflowText, actionUses = ACTION_USES) {
  const workflow = yaml.load(workflowText);
  const keys = new Set();
  for (const job of Object.values(workflow?.jobs ?? {})) {
    for (const step of job?.steps ?? []) {
      if (step?.uses === actionUses) {
        for (const key of Object.keys(step.env ?? {})) {
          keys.add(key);
        }
      }
    }
  }
  return keys;
}

function sortedDifference(a, b) {
  return [...a].filter((item) => !b.has(item)).sort();
}

/** Repo-relative path with forward slashes, so the diagnostic reads the same on every platform. */
function repoPath(absolute) {
  return path.relative(workspaceRoot, absolute).split(path.sep).join('/');
}

/**
 * Compare the parsed inputs and return one problem per drift, in the shape
 * `tools/infra/validate-kustomize.js` already renders.
 *
 * @param {{ records: Array, actionPairs: Array, workflowEnvKeys: Set<string>, envExampleActual: string|null, envExampleExpected: string }} inputs
 */
function findSecretDriftProblems(inputs) {
  const { records, actionPairs, workflowEnvKeys } = inputs;
  const problems = [];

  // R1 — manifest keys against the action's assignment targets.
  const manifestKeys = new Set(records.map((record) => record.key));
  const actionKeys = new Set(actionPairs.map((pair) => pair.key));

  const missingInAction = sortedDifference(manifestKeys, actionKeys);
  if (missingInAction.length > 0) {
    problems.push({
      headline: 'Secret manifest keys the deploy action never substitutes',
      items: missingInAction,
      detail: [
        'Each of these would deploy the committed placeholder to every environment.',
        `Add a matching yq line to ${repoPath(ACTION_PATH)}.`,
      ],
    });
  }

  const missingInManifests = sortedDifference(actionKeys, manifestKeys);
  if (missingInManifests.length > 0) {
    problems.push({
      headline: 'Keys the deploy action substitutes that no secret manifest declares',
      items: missingInManifests,
      detail: [
        'A yq assignment creates the key, so a stale line writes a field nothing reads.',
        `Remove the line from ${repoPath(ACTION_PATH)} or restore the manifest key.`,
      ],
    });
  }

  // R2 — the action's variables against the workflow env block.
  const actionEnvVars = new Set(actionPairs.map((pair) => pair.envVar));
  const missingInWorkflow = sortedDifference(actionEnvVars, workflowEnvKeys);
  if (missingInWorkflow.length > 0) {
    problems.push({
      headline: 'Variables the deploy action reads that the workflow never passes',
      items: missingInWorkflow,
      detail: [
        'An unset variable makes yq write a null into stringData, which kubectl rejects.',
        `Add each one to the deploy step env: block in ${repoPath(WORKFLOW_PATH)}.`,
      ],
    });
  }

  // R3 — the committed .env.example against the derivation.
  if (normalize(inputs.envExampleActual) !== normalize(inputs.envExampleExpected)) {
    problems.push({
      headline: '.env.example does not match the secret manifests',
      items: ['.env.example'],
      detail: ['Regenerate it: pnpm run infra:secrets:example'],
    });
  }

  return problems;
}

function normalize(text) {
  return typeof text === 'string' ? text.replace(/\r\n/g, '\n') : text;
}

/** Read every input from disk and run the comparison. */
function checkSecretDrift(options = {}) {
  const actionPath = options.actionPath || ACTION_PATH;
  const workflowPath = options.workflowPath || WORKFLOW_PATH;
  const envExamplePath = options.envExamplePath || ENV_EXAMPLE_PATH;

  const records = deriveSecretKeys(options);

  return findSecretDriftProblems({
    records,
    actionPairs: parseActionSubstitutions(fs.readFileSync(actionPath, 'utf-8')),
    workflowEnvKeys: parseWorkflowEnvKeys(fs.readFileSync(workflowPath, 'utf-8')),
    envExampleActual: fs.existsSync(envExamplePath)
      ? fs.readFileSync(envExamplePath, 'utf-8')
      : null,
    envExampleExpected: renderEnvExample(records),
  });
}

/** Run the gate and return the process exit code. Tests call this directly. */
function main(options = {}) {
  const problems = checkSecretDrift(options);
  if (problems.length === 0) {
    console.log('✓ secret keys agree across the manifests, the deploy action and .env.example');
    return 0;
  }
  console.error('✗ secret key drift detected');
  for (const problem of problems) {
    console.error(`  ${problem.headline}:`);
    for (const item of problem.items) {
      console.error(`    - ${item}`);
    }
    for (const line of problem.detail) {
      console.error(`    ${line}`);
    }
  }
  return 1;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = {
  main,
  checkSecretDrift,
  findSecretDriftProblems,
  parseActionSubstitutions,
  parseWorkflowEnvKeys,
  ACTION_PATH,
  WORKFLOW_PATH,
  ACTION_USES,
};
