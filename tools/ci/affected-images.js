#!/usr/bin/env node
/**
 * Narrow the container-image build matrix to images whose contents can actually change.
 *
 * WHY THIS EXISTS
 *
 * The image matrix is produced by `nx show projects --affected --withTarget=container-build`.
 * Nx treats a handful of root files — `pnpm-lock.yaml`, `nx.json`, root `package.json` — as global
 * inputs, so touching any of them marks EVERY project affected. That is the right answer for Nx's
 * question ("could this project's build behave differently?") but the wrong answer for ours ("could
 * this IMAGE come out different?"). A pnpm lockfile cannot change a .NET image or a Python image or
 * a plain Postgres image, because no line of those Dockerfiles ever reads it.
 *
 * The cost of the wrong answer is not just time. Every PR rebuilt every image, so one image's
 * unrelated flakiness failed unrelated PRs — a HuggingFace 429 in the inference image's model
 * download blocked a PR that only touched Postgres migrations.
 *
 * HOW IT DECIDES
 *
 * The Dockerfile already declares exactly what enters the image: its `COPY`/`ADD` sources and its
 * `RUN --mount=type=bind` sources. That is the source of truth, so it is what this reads. Nothing
 * has to be kept in sync by hand — which matters here, because the repo's existing two-registry
 * deployment gate is documented as failing silently when someone forgets an entry, and a third
 * hand-maintained list would be a third way to fail silently.
 *
 * This only ever REMOVES projects from the list Nx produced. It cannot add one, so it cannot
 * introduce a build that Nx's dependency-graph analysis did not already call for.
 *
 * FAIL-OPEN, ALWAYS
 *
 * Every uncertain case keeps the project in the matrix: an unresolvable Dockerfile, one that parses
 * to no context inputs, a `COPY . .`, or any change to the shared build tooling. A needless rebuild
 * costs minutes; a skipped rebuild ships a stale image.
 *
 * Usage:
 *   node tools/ci/affected-images.js --base=origin/dev --projects="a b c"
 *   node tools/ci/affected-images.js --base=origin/dev --projects="a b c" --explain
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const IMAGE_NAME_MAP = 'tools/docker/image-name-map.json';

/**
 * Changes to the machinery that builds images can alter every image without touching any
 * Dockerfile, so they disable narrowing entirely rather than being matched per project.
 *
 * Deliberately NOT the whole of `tools/docker/`: CI never invokes `build-image.js` — it calls
 * docker/build-push-action directly — so those scripts only affect local skaffold builds. The one
 * file CI does read is `image-name-map.json`, and that is compared entry-by-entry below rather than
 * listed here, because adding a new service to the map must not rebuild every existing image.
 */
const BUILD_TOOLING_PREFIXES = [
  '.github/actions/build-push-image/',
  '.github/workflows/build-push-images.yml',
  'tools/ci/affected-images.js',
  // Every image is built with `context=.`, so the root .dockerignore decides what a directory COPY
  // actually yields — and it is load-bearing here, not cosmetic: its own comments record that
  // getting the node_modules glob wrong overwrites the deps stage's Linux symlinks. A change to it
  // can therefore alter an image whose Dockerfile did not change at all.
  //
  // A per-Dockerfile `<dockerfile>.dockerignore` needs no entry: it sits beside its Dockerfile, so
  // the Dockerfile's own directory already covers it.
  '.dockerignore',
];

/** Reads the image-name map as of a git ref. Returns null when absent or unparseable. */
function readMapAtRef(ref) {
  try {
    const out = execFileSync('git', ['show', `${ref}:${IMAGE_NAME_MAP}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return JSON.parse(out);
  } catch {
    return null;
  }
}

/** Reads the image-name map from the checked-out tree. Returns null when absent or unparseable. */
function readMapFromTree() {
  try {
    return JSON.parse(fs.readFileSync(IMAGE_NAME_MAP, 'utf8'));
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const args = { base: '', head: 'HEAD', projects: '', explain: false };
  for (const arg of argv) {
    if (arg.startsWith('--base=')) args.base = arg.slice('--base='.length);
    else if (arg.startsWith('--head=')) args.head = arg.slice('--head='.length);
    else if (arg.startsWith('--projects=')) args.projects = arg.slice('--projects='.length);
    else if (arg === '--explain') args.explain = true;
  }
  return args;
}

function changedFiles(base, head) {
  // Three-dot: compare against the merge base, matching how `nx --affected --base` scopes a branch.
  const out = execFileSync('git', ['diff', '--name-only', `${base}...${head}`], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Mirrors the resolution order in .github/actions/build-push-image/action.yml. */
function resolveDockerfile(project) {
  if (fs.existsSync(IMAGE_NAME_MAP)) {
    try {
      const map = JSON.parse(fs.readFileSync(IMAGE_NAME_MAP, 'utf8'));
      const override = map[project] && map[project].dockerfilePath;
      if (override) {
        const candidate = `${override}/Dockerfile`;
        if (fs.existsSync(candidate)) return candidate;
      }
    } catch {
      return null; // Unreadable map — fail open.
    }
  }
  for (const candidate of [
    `apps/${project}/Dockerfile`,
    `apps/services/${project}/Dockerfile`,
    `libs/${project}/Dockerfile`,
  ]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** Joins backslash line continuations so each instruction is a single logical line. */
function logicalLines(text) {
  return text
    .replace(/\\[ \t]*\r?\n/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

/**
 * Extracts the build-context paths an instruction reads.
 *
 * `COPY --from=<stage>` copies between build stages, not from the context, so it is skipped — the
 * files it moves were already accounted for where they entered the earlier stage.
 */
function contextInputs(line) {
  const mounts = [];
  for (const match of line.matchAll(/--mount=([^\s]+)/g)) {
    const fields = match[1].split(',');
    const isBind = fields.some((f) => f === 'type=bind');
    const source = fields.find((f) => f.startsWith('source='));
    if (isBind && source) mounts.push(source.slice('source='.length));
  }
  if (mounts.length) return mounts;

  if (!/^(COPY|ADD)\s/i.test(line)) return [];
  if (/\s--from=/i.test(line)) return [];

  const withoutInstruction = line.replace(/^(COPY|ADD)\s+/i, '');
  const withoutFlags = withoutInstruction.replace(/(^|\s)--[^\s]+/g, ' ').trim();

  let parts;
  if (withoutFlags.startsWith('[')) {
    try {
      parts = JSON.parse(withoutFlags);
    } catch {
      return null; // Malformed JSON form — fail open for this Dockerfile.
    }
  } else {
    parts = withoutFlags.split(/\s+/).filter(Boolean);
  }
  // The final argument is the destination inside the image, never a context path.
  return parts.slice(0, -1);
}

/**
 * The set of context paths a Dockerfile reads, plus its own directory.
 *
 * Returns null when the image should not be narrowed at all — an unreadable Dockerfile, no context
 * inputs found, or a whole-context copy.
 */
function imageInputs(dockerfilePath) {
  let text;
  try {
    text = fs.readFileSync(dockerfilePath, 'utf8');
  } catch {
    return null;
  }

  const inputs = new Set();
  // The Dockerfile's own directory: it holds the Dockerfile itself and, by convention here, the
  // project's Nx config. Both change what gets built without appearing in any COPY.
  inputs.add(path.dirname(dockerfilePath).split(path.sep).join('/'));

  for (const line of logicalLines(text)) {
    const found = contextInputs(line);
    if (found === null) return null;
    for (const raw of found) {
      const normalized = raw.replace(/\\/g, '/').replace(/\/+$/, '').replace(/^\.\//, '');
      if (normalized === '' || normalized === '.') return null; // Whole context.
      inputs.add(normalized);
    }
  }
  return inputs.size ? inputs : null;
}

function fileMatches(file, inputs) {
  for (const input of inputs) {
    if (file === input || file.startsWith(`${input}/`)) return true;
  }
  return false;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const projects = args.projects.split(/[\s,]+/).filter(Boolean);
  const explain = (msg) => {
    if (args.explain) process.stderr.write(`${msg}\n`);
  };

  if (!projects.length) {
    process.stdout.write('');
    return;
  }
  if (!args.base) {
    explain('No --base supplied; keeping the full matrix.');
    process.stdout.write(projects.join(' '));
    return;
  }

  let changed;
  try {
    changed = changedFiles(args.base, args.head);
  } catch (error) {
    explain(`Could not diff against ${args.base} (${error.message}); keeping the full matrix.`);
    process.stdout.write(projects.join(' '));
    return;
  }

  const toolingChange = changed.find((file) =>
    BUILD_TOOLING_PREFIXES.some((prefix) =>
      prefix.endsWith('/') ? file.startsWith(prefix) : file === prefix,
    ),
  );
  if (toolingChange) {
    explain(`Shared image build tooling changed (${toolingChange}); keeping the full matrix.`);
    process.stdout.write(projects.join(' '));
    return;
  }

  // The image-name map decides which Dockerfile a project builds from and what the image is
  // called, so a change to a project's own entry must rebuild it. Compare entry-by-entry: adding a
  // NEW service to the map is the common case, and it says nothing about the existing images.
  let mapEntries = null;
  if (changed.includes(IMAGE_NAME_MAP)) {
    const baseMap = readMapAtRef(args.base);
    const headMap = readMapFromTree();
    if (!baseMap || !headMap) {
      explain(`${IMAGE_NAME_MAP} changed and could not be compared; keeping the full matrix.`);
      process.stdout.write(projects.join(' '));
      return;
    }
    mapEntries = { baseMap, headMap };
  }

  const kept = projects.filter((project) => {
    if (mapEntries) {
      const before = JSON.stringify(mapEntries.baseMap[project]);
      const after = JSON.stringify(mapEntries.headMap[project]);
      if (before !== after) {
        explain(`${project}: rebuilding (its ${IMAGE_NAME_MAP} entry changed).`);
        return true;
      }
    }
    const dockerfile = resolveDockerfile(project);
    if (!dockerfile) {
      explain(`${project}: no Dockerfile resolved — keeping.`);
      return true;
    }
    const inputs = imageInputs(dockerfile);
    if (!inputs) {
      explain(`${project}: ${dockerfile} declares no narrowable context — keeping.`);
      return true;
    }
    const hit = changed.find((file) => fileMatches(file, inputs));
    if (hit) {
      explain(`${project}: rebuilding (${hit} is an input to ${dockerfile}).`);
      return true;
    }
    explain(`${project}: skipping — no changed file enters ${dockerfile}.`);
    return false;
  });

  process.stdout.write(kept.join(' '));
}

if (require.main === module) {
  main();
}

module.exports = { contextInputs, imageInputs, logicalLines, fileMatches, resolveDockerfile };
