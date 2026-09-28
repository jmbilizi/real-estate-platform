'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveBase, parseArgs, ghRunListArgs } = require('./last-success-base');

test('#446: explicit override wins and skips the lookup entirely', () => {
  const findLastSuccess = () => {
    throw new Error('should not be called');
  };
  const result = resolveBase({
    workflow: 'build-push-images.yml',
    branch: 'dev',
    head: 'HEAD',
    explicitBefore: 'deadbeef',
    findLastSuccess,
    checkAncestor: () => true,
  });
  assert.equal(result.base, 'deadbeef');
  assert.match(result.reason, /explicit override/);
});

test('#446: a found and verified ancestor is used as the base', () => {
  const result = resolveBase({
    workflow: 'build-push-images.yml',
    branch: 'dev',
    head: 'HEAD',
    explicitBefore: '',
    findLastSuccess: () => 'abc123',
    checkAncestor: (sha, head) => sha === 'abc123' && head === 'HEAD',
  });
  assert.equal(result.base, 'abc123');
});

test('#446: no successful run found falls back to empty (build/deploy everything)', () => {
  const result = resolveBase({
    workflow: 'build-push-images.yml',
    branch: 'dev',
    head: 'HEAD',
    explicitBefore: '',
    findLastSuccess: () => null,
    checkAncestor: () => true,
  });
  assert.equal(result.base, '');
  assert.match(result.reason, /no successful/);
});

test('#446: a found run that is not an ancestor of HEAD is rejected, not trusted', () => {
  // E.g. the branch was rewritten, or the run belongs to a different lineage.
  const result = resolveBase({
    workflow: 'build-push-images.yml',
    branch: 'dev',
    head: 'HEAD',
    explicitBefore: '',
    findLastSuccess: () => 'stale-sha',
    checkAncestor: () => false,
  });
  assert.equal(result.base, '');
  assert.match(result.reason, /not an ancestor/);
});

test('#446: parseArgs reads all flags', () => {
  const args = parseArgs([
    '--workflow=deploy-k8s-resources.yml',
    '--branch=dev',
    '--head=abc',
    '--repo=jmbilizi/real-estate-platform',
    '--explicit-before=def',
  ]);
  assert.deepEqual(args, {
    workflow: 'deploy-k8s-resources.yml',
    branch: 'dev',
    head: 'abc',
    repo: 'jmbilizi/real-estate-platform',
    explicitBefore: 'def',
  });
});

test('#446: parseArgs defaults head to HEAD, repo and explicitBefore to empty', () => {
  const args = parseArgs(['--workflow=build-push-images.yml', '--branch=dev']);
  assert.deepEqual(args, {
    workflow: 'build-push-images.yml',
    branch: 'dev',
    head: 'HEAD',
    repo: '',
    explicitBefore: '',
  });
});

test('#446: ghRunListArgs filters to a successful workflow_dispatch run, excluding a workflow_call dry run', () => {
  const args = ghRunListArgs('build-push-images.yml', 'dev', '');
  assert.deepEqual(args, [
    'run',
    'list',
    '--workflow',
    'build-push-images.yml',
    '--branch',
    'dev',
    '--status',
    'success',
    '--event',
    'workflow_dispatch',
    '--json',
    'headSha',
    '-L',
    '1',
  ]);
});

test('#446: ghRunListArgs appends --repo only when one is given', () => {
  const withoutRepo = ghRunListArgs('deploy-k8s-resources.yml', 'dev', '');
  assert.ok(!withoutRepo.includes('--repo'));

  const withRepo = ghRunListArgs(
    'deploy-k8s-resources.yml',
    'dev',
    'jmbilizi/real-estate-platform',
  );
  assert.deepEqual(withRepo.slice(-2), ['--repo', 'jmbilizi/real-estate-platform']);
});

test('#446: resolveBase passes repo through to the run lookup', () => {
  let seenRepo;
  const result = resolveBase({
    workflow: 'build-push-images.yml',
    branch: 'dev',
    head: 'HEAD',
    repo: 'jmbilizi/real-estate-platform',
    explicitBefore: '',
    findLastSuccess: (workflow, branch, repo) => {
      seenRepo = repo;
      return 'abc123';
    },
    checkAncestor: () => true,
  });
  assert.equal(seenRepo, 'jmbilizi/real-estate-platform');
  assert.equal(result.base, 'abc123');
});
