'use strict';

/**
 * #315: NODE_OPTIONS --max-old-space-size must track the ingest container's memory limit.
 * Node otherwise sizes its heap from the host, not the container, and OOMs. The rule
 * (limits.memory / RATIO) lives once, here. This module checks every environment's
 * effective sizing against it, so a limit change with no matching NODE_OPTIONS update
 * fails tools:test.
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
  base: path.join(REPO_ROOT, 'infra/k8s/base/cronjobs/bright-mls-ingest.cronjob.yaml'),
  'hetzner/dev': path.join(
    REPO_ROOT,
    'infra/k8s/hetzner/dev/patches/cronjobs/bright-mls-ingest.cronjob.yaml',
  ),
  'hetzner/test': path.join(
    REPO_ROOT,
    'infra/k8s/hetzner/test/patches/cronjobs/bright-mls-ingest.cronjob.yaml',
  ),
  'hetzner/prod': path.join(
    REPO_ROOT,
    'infra/k8s/hetzner/prod/patches/cronjobs/bright-mls-ingest.cronjob.yaml',
  ),
  'podman/local': path.join(
    REPO_ROOT,
    'infra/k8s/podman/local/patches/cronjobs/bright-mls-ingest.cronjob.yaml',
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

function findIngestContainer(doc) {
  const containers = doc?.spec?.jobTemplate?.spec?.template?.spec?.containers ?? [];
  return containers.find((container) => container.name === 'ingest') ?? null;
}

/**
 * Reads one CronJob or CronJob patch file. `limitMi` / `maxOldSpaceSize` are `null` when
 * the file does not set that field itself — a patch inherits it from base, that is not
 * an error.
 */
function readIngestSizing(filePath) {
  const doc = yaml.load(fs.readFileSync(filePath, 'utf-8'));
  const container = findIngestContainer(doc);
  if (!container) {
    return { error: 'no "ingest" container found' };
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
 */
function checkNodeHeapRatio(files = DEFAULT_FILES) {
  const problems = [];
  const baseSizing = readIngestSizing(files.base);
  if (baseSizing.error) {
    return [`base: ${baseSizing.error}`];
  }

  for (const [label, file] of Object.entries(files)) {
    const sizing = label === 'base' ? baseSizing : readIngestSizing(file);
    if (sizing.error) {
      problems.push(`${label}: ${sizing.error}`);
      continue;
    }

    const effectiveLimit = sizing.limitMi ?? baseSizing.limitMi;
    const effectiveNodeOptions = sizing.maxOldSpaceSize ?? baseSizing.maxOldSpaceSize;
    if (effectiveLimit == null) {
      problems.push(
        `${label}: no ingest resources.limits.memory in "<n>Mi" form, in this file or base`,
      );
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
  readIngestSizing,
  checkNodeHeapRatio,
};
