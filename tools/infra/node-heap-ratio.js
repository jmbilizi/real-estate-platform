'use strict';

/**
 * #315: NODE_OPTIONS --max-old-space-size must track a workload's own memory limit. Node
 * otherwise sizes its heap from the host, not the container, and OOMs. The rule
 * (limits.memory / RATIO) lives once, here. This module checks every environment's
 * effective sizing against it, so a limit change with no matching NODE_OPTIONS update
 * fails tools:test.
 *
 * Generic across CronJob and Deployment manifests: it reads the first (only) container of
 * either `spec.jobTemplate.spec.template.spec.containers` (CronJob) or
 * `spec.template.spec.containers` (Deployment), by position rather than by name, so it needs
 * no per-workload configuration beyond the file paths below (#338, moved from checking the
 * bright-mls-ingest CronJob to checking the bright-sync-worker Deployment that replaced it).
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const RATIO = 1.5;

const REPO_ROOT = path.resolve(__dirname, '../..');

/**
 * One entry per environment. Each patch strategic-merges onto base: a field it does not
 * set is inherited from base, not zero. "base" itself has no fallback.
 */
const DEFAULT_FILES = {
  base: path.join(REPO_ROOT, 'infra/k8s/base/deployments/bright-sync-worker.deployment.yaml'),
  'hetzner/dev': path.join(
    REPO_ROOT,
    'infra/k8s/hetzner/dev/patches/deployments/bright-sync-worker.deployment.yaml',
  ),
  'hetzner/test': path.join(
    REPO_ROOT,
    'infra/k8s/hetzner/test/patches/deployments/bright-sync-worker.deployment.yaml',
  ),
  'hetzner/prod': path.join(
    REPO_ROOT,
    'infra/k8s/hetzner/prod/patches/deployments/bright-sync-worker.deployment.yaml',
  ),
  'podman/local': path.join(
    REPO_ROOT,
    'infra/k8s/podman/local/patches/deployments/bright-sync-worker.deployment.yaml',
  ),
};

function computeMaxOldSpaceSize(limitMi) {
  return Math.floor(limitMi / RATIO);
}

function parseMemoryMi(value) {
  const match = /^(\d+)Mi$/.exec(String(value ?? ''));
  return match ? Number(match[1]) : null;
}

function parseMaxOldSpaceSize(nodeOptionsValue) {
  const match = /--max-old-space-size=(\d+)/.exec(String(nodeOptionsValue ?? ''));
  return match ? Number(match[1]) : null;
}

function findWorkloadContainer(doc) {
  const containers =
    doc?.spec?.jobTemplate?.spec?.template?.spec?.containers ?? // CronJob
    doc?.spec?.template?.spec?.containers ?? // Deployment
    [];
  return containers[0] ?? null;
}

/**
 * Reads one manifest or patch file (CronJob or Deployment). `limitMi` / `maxOldSpaceSize` are
 * `null` when the file does not set that field itself — a patch inherits it from base, that is
 * not an error.
 */
function readWorkloadSizing(filePath) {
  const doc = yaml.load(fs.readFileSync(filePath, 'utf-8'));
  const container = findWorkloadContainer(doc);
  if (!container) {
    return { error: 'no container found' };
  }
  const limitMi = parseMemoryMi(container.resources?.limits?.memory);
  const nodeOptions = (container.env ?? []).find((entry) => entry.name === 'NODE_OPTIONS');
  const maxOldSpaceSize = parseMaxOldSpaceSize(nodeOptions?.value);
  return { limitMi, maxOldSpaceSize };
}

/**
 * Returns one problem string per environment whose EFFECTIVE NODE_OPTIONS does not match
 * floor(effective limits.memory / RATIO), after a patch's own value wins over base's. An
 * empty array means every environment agrees with the rule.
 *
 * `base` is skipped as a checked environment only when it sets neither field. A base carries no
 * `resources` by repo rule (AGENTS.md "Minimal Base Architecture"). A base that sets either field
 * is checked like any overlay.
 */
function checkNodeHeapRatio(files = DEFAULT_FILES) {
  const problems = [];
  const baseSizing = readWorkloadSizing(files.base);
  if (baseSizing.error) {
    return [`base: ${baseSizing.error}`];
  }
  const baseSetsNothing = baseSizing.limitMi == null && baseSizing.maxOldSpaceSize == null;

  for (const [label, file] of Object.entries(files)) {
    if (label === 'base' && baseSetsNothing) continue;
    const sizing = label === 'base' ? baseSizing : readWorkloadSizing(file);
    if (sizing.error) {
      problems.push(`${label}: ${sizing.error}`);
      continue;
    }

    const effectiveLimit = sizing.limitMi ?? baseSizing.limitMi;
    const effectiveNodeOptions = sizing.maxOldSpaceSize ?? baseSizing.maxOldSpaceSize;
    if (effectiveLimit == null) {
      problems.push(`${label}: no resources.limits.memory in "<n>Mi" form, in this file or base`);
      continue;
    }
    if (effectiveNodeOptions == null) {
      problems.push(`${label}: no NODE_OPTIONS --max-old-space-size, in this file or base`);
      continue;
    }

    const expected = computeMaxOldSpaceSize(effectiveLimit);
    if (effectiveNodeOptions !== expected) {
      problems.push(
        `${label}: effective NODE_OPTIONS --max-old-space-size=${effectiveNodeOptions}, ` +
          `expected ${expected} (effective limits.memory ${effectiveLimit}Mi / ${RATIO})`,
      );
    }
  }
  return problems;
}

module.exports = {
  RATIO,
  DEFAULT_FILES,
  computeMaxOldSpaceSize,
  parseMemoryMi,
  parseMaxOldSpaceSize,
  readWorkloadSizing,
  checkNodeHeapRatio,
};
