/**
 * Resolves an Nx project name to its workspace-relative root directory, by reading `project.json`
 * files directly rather than shelling out to `nx show project`.
 *
 * Shared by tools/docker/build-image.js and tools/ci/affected-images.js — kept here rather than in
 * either domain's script because both need the same answer and must agree on it.
 *
 * Why no subprocess. Both callers previously spawned `pnpm exec nx show project <name> --json`, and
 * both had to interpolate the project name into a shell: `execSync` with a template string in one,
 * `execFileSync(..., { shell: true })` in the other. A project name reaches these scripts from CLI
 * args and from the CI matrix, so a name carrying shell metacharacters was both an injection shape
 * and — more mundanely — a correctness bug, since scoped project names legitimately contain `@` and
 * `/`.
 *
 * The obvious fix (`pnpm.cmd` on Windows with the shell disabled) does NOT work: Node refuses to
 * execute a `.cmd` without a shell, so `execFileSync('pnpm.cmd', args)` throws EINVAL on Node
 * >=18.20.2/20.12.2 — verified on this repo's Node 20.19.5. Reading the files removes the shell,
 * the subprocess, the injection surface and every platform branch in one move, and is faster than
 * booting the Nx daemon.
 *
 * Returns a POSIX-separated, workspace-relative path (e.g. `libs/property-contracts`) so callers
 * can join it or compare it against git output without normalising separators themselves. Returns
 * `null` when the project is unknown or its `project.json` is unreadable — callers decide what an
 * unknown project means; `affected-images.js` in particular must fail open.
 */

const fs = require('node:fs');
const path = require('node:path');

const WORKSPACE_ROOT = path.resolve(__dirname, '../..');

/** Only these trees hold Nx projects; scanning the whole workspace would walk node_modules. */
const SEARCH_ROOTS = ['apps', 'libs'];

/** Directories that never contain a project we care about but are expensive or noisy to walk. */
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.nx',
  '.next',
  'bin',
  'obj',
  'coverage',
  '.venv',
  '__pycache__',
]);

/**
 * Nx projects sit shallowly: `libs/<name>` (2), `apps/services/<name>` (3),
 * `apps/clients/cribstop/next` (4). A small ceiling keeps the walk bounded without excluding a
 * plausible layout.
 */
const MAX_DEPTH = 5;

/** Memoised across calls — `affected-images.js` resolves several projects per run. */
let cachedIndex = null;

function collectProjectFiles(absDir, depth, found) {
  if (depth > MAX_DEPTH) return;

  let entries;
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return; // Unreadable directory is not fatal — a missing project resolves to null.
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name)) continue;

    const childDir = path.join(absDir, entry.name);
    const manifest = path.join(childDir, 'project.json');
    if (fs.existsSync(manifest)) found.push(manifest);

    // Keep descending even past a match: a project may nest another (none do today, but the
    // walk should not encode that assumption).
    collectProjectFiles(childDir, depth + 1, found);
  }
}

/** Builds the projectName -> workspace-relative-root index. */
function buildIndex() {
  const manifests = [];
  for (const root of SEARCH_ROOTS) {
    collectProjectFiles(path.join(WORKSPACE_ROOT, root), 1, manifests);
  }

  const index = new Map();
  for (const manifest of manifests) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    } catch {
      continue; // A malformed project.json shouldn't hide every other project.
    }
    if (typeof parsed.name !== 'string' || !parsed.name) continue;

    const relative = path.relative(WORKSPACE_ROOT, path.dirname(manifest));
    index.set(parsed.name, relative.split(path.sep).join('/'));
  }
  return index;
}

/**
 * @param {string} projectName Nx project name, which may be scoped (`@cribstop/property-contracts`).
 * @returns {string|null} Workspace-relative POSIX path, or null if the project is unknown.
 */
function resolveProjectRoot(projectName) {
  if (typeof projectName !== 'string' || !projectName) return null;
  if (!cachedIndex) cachedIndex = buildIndex();
  return cachedIndex.get(projectName) ?? null;
}

/** Test seam — forces the next resolve to re-read the filesystem. */
function clearCache() {
  cachedIndex = null;
}

module.exports = { resolveProjectRoot, clearCache };
