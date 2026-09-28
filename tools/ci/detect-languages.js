#!/usr/bin/env node
/**
 * Picks which CI language jobs (node/python/dotnet) a change needs.
 *
 * WHY THIS EXISTS
 *
 * The old `dorny/paths-filter` step in `.github/workflows/ci.yml` picked a job by file extension.
 * A PR that changed only `apps/api-gateway/Configuration/Routes/*.json` skipped the `dotnet` job,
 * because `.json` is not in the dotnet filter — even though the file belongs to a .NET Nx project
 * (#443). The QoS guard test then failed only after merge, on `dev`.
 *
 * HOW IT DECIDES
 *
 * For each changed file:
 *   1. Find the Nx project that owns it (the longest matching project root under apps/ or libs/).
 *   2. If found, read that project's `runtime:*` tag from its `project.json` — the same source
 *      `nx show project --json` reads — and mark that runtime, regardless of the file's extension.
 *   3. If the file belongs to no project (e.g. `tools/dotnet/**`, root `pyproject.toml`), fall back
 *      to the extension rule. This is the only place a hand-kept path list still applies, and it is
 *      deliberate: those files never belong to a project's tags.
 *
 * Usage:
 *   node tools/ci/detect-languages.js --base=origin/dev [--head=HEAD] [--output=$GITHUB_OUTPUT]
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

const { listProjects } = require('../lib/project-root');

/** Extension-based fallback, for files outside any Nx project. Mirrors the prior paths-filter. */
const FALLBACK_PATTERNS = {
  node: [
    /\.tsx?$/,
    /\.jsx?$/,
    /\.mjs$/,
    /\.cjs$/,
    /(^|\/)package\.json$/,
    /(^|\/)tsconfig[^/]*\.json$/,
    /^pnpm-lock\.yaml$/,
    /^tools\/node\//,
  ],
  python: [
    /\.py$/,
    /\.pyx$/,
    /\.pxd$/,
    /\.pyi$/,
    /\.ipynb$/,
    /(^|\/)pyproject\.toml$/,
    /^uv\.lock$/,
    /^tools\/python\//,
  ],
  dotnet: [
    /\.cs$/,
    /\.vb$/,
    /\.csproj$/,
    /\.sln$/,
    /\.fsproj$/,
    /(^|\/)Directory\.[^/]+\.(props|targets)$/,
    /(^|\/)nuget\.config$/,
    /(^|\/)global\.json$/,
    /^tools\/dotnet\//,
  ],
};

const RUNTIME_TAG_PREFIX = 'runtime:';

/** Reads the `runtime:*` tag off a project's tags. Returns null when it has none or several. */
function runtimeOf(project) {
  const runtimeTags = project.tags.filter((t) => t.startsWith(RUNTIME_TAG_PREFIX));
  if (runtimeTags.length !== 1) return null;
  const runtime = runtimeTags[0].slice(RUNTIME_TAG_PREFIX.length);
  return FALLBACK_PATTERNS[runtime] ? runtime : null;
}

/** Finds the project owning `file` by longest-prefix match on project root. Null if none owns it. */
function projectForFile(file, projects) {
  let best = null;
  for (const project of projects) {
    if (file !== project.root && !file.startsWith(`${project.root}/`)) continue;
    if (!best || project.root.length > best.root.length) best = project;
  }
  return best;
}

function matchesFallback(file, runtime) {
  return FALLBACK_PATTERNS[runtime].some((pattern) => pattern.test(file));
}

/**
 * Pure core: given the changed files and the workspace's projects, decides which runtimes CI needs.
 *
 * @param {string[]} changedFiles Workspace-relative, forward-slashed paths.
 * @param {Array<{root: string, tags: string[]}>} projects From `listProjects()`.
 * @returns {{node: boolean, python: boolean, dotnet: boolean}}
 */
function detectLanguages(changedFiles, projects) {
  const result = { node: false, python: false, dotnet: false };

  for (const file of changedFiles) {
    const project = projectForFile(file, projects);
    const runtime = project ? runtimeOf(project) : null;
    if (runtime) {
      result[runtime] = true;
      continue; // The project's tag decided — extension fallback does not apply.
    }
    // No project owns this file, or it owns one whose runtime tag is missing/unrecognized (for
    // example a project just generated, before `pnpm run nx:reset` adds its runtime:* tag).
    // Falling back to the extension rule here, rather than skipping, keeps that case from
    // reproducing #443 under a different trigger.
    for (const fallbackRuntime of Object.keys(result)) {
      if (matchesFallback(file, fallbackRuntime)) result[fallbackRuntime] = true;
    }
  }

  return result;
}

function changedFiles(base, head) {
  const out = execFileSync('git', ['diff', '--name-only', `${base}...${head}`], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseArgs(argv) {
  const args = { base: '', head: 'HEAD', output: '' };
  for (const arg of argv) {
    if (arg.startsWith('--base=')) args.base = arg.slice('--base='.length);
    else if (arg.startsWith('--head=')) args.head = arg.slice('--head='.length);
    else if (arg.startsWith('--output=')) args.output = arg.slice('--output='.length);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.base) {
    console.error('✗ --base=<ref> is required.');
    process.exit(1);
  }

  const files = changedFiles(args.base, args.head);
  const result = detectLanguages(files, listProjects());

  const lines = Object.entries(result)
    .map(([runtime, needed]) => `${runtime}=${needed}`)
    .join('\n');

  console.info(lines);
  const outputPath = args.output || process.env.GITHUB_OUTPUT;
  if (outputPath) {
    fs.appendFileSync(outputPath, `${lines}\n`);
  }
}

module.exports = { detectLanguages, projectForFile, runtimeOf, matchesFallback, FALLBACK_PATTERNS };

if (require.main === module) {
  main();
}
