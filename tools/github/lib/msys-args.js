/**
 * Undo MSYS path conversion on the arguments of the tools/github/*.js scripts.
 *
 * Git Bash and MSYS2 rewrite an argument that starts with `/` into a Windows path before the
 * argument reaches a native program. `pnpm` is a native program, so the value is already corrupt
 * in `process.argv` — the conversion happens one hop above Node, and quoting does not stop it:
 *
 *   pnpm run gh:ticket:create -- --title "/api/overpass check"
 *   -> process.argv holds "C:/Program Files/Git/api/overpass check"
 *
 * That is how #113 got its title. `MSYS_NO_PATHCONV=1` fixes it only if the caller exports it
 * before the command, which no agent and no reader of AGENTS.md does. So the scripts repair the
 * value themselves: the conversion prepends the MSYS installation root and nothing else, so
 * stripping that exact prefix restores the original byte for byte.
 *
 * The repair is deliberately narrow. It runs only when MSYS reports itself through `MSYSTEM`, and
 * only on a value whose prefix is the MSYS root. On macOS and Linux every function here is a no-op.
 */

const fs = require('fs');
const path = require('path');

/**
 * Flags whose value is a filesystem path. MSYS conversion of those is the feature working as
 * intended (`--body-file /c/tmp/x.md` must become `C:/tmp/x.md`), so they are never repaired.
 * They get a diagnosis instead: see `describeMangledFileArg`.
 */
const PATH_FLAGS = new Set(['body-file', 'plan-file', 'description-file', 'input-file']);

const toPosix = (value) => value.replace(/\\/g, '/').replace(/\/+$/, '');

/**
 * The directory that MSYS maps to `/`. Git Bash maps it to the Git install root
 * (`C:/Program Files/Git`), MSYS2 to the MSYS root (`C:/msys64`). Neither exports it directly, so
 * derive it from the interpreter location by dropping the `bin` and `usr/bin` tail.
 */
function deriveRoot(candidate) {
  let dir = toPosix(candidate);
  for (let i = 0; i < 2; i++) {
    const base = path.posix.basename(dir).toLowerCase();
    if (base !== 'bin' && base !== 'usr') break;
    dir = path.posix.dirname(dir);
  }
  return dir;
}

let cachedRoot;

/** The MSYS root for this process, or `null` when not running under MSYS. */
function msysRoot(env = process.env) {
  if (env === process.env && cachedRoot !== undefined) return cachedRoot;

  let root = null;
  if (process.platform === 'win32' && env.MSYSTEM) {
    // SHELL is the bash executable, EXEPATH the directory it was launched from. Either can be
    // absent or already be the root itself, so try both and keep the first that exists on disk.
    const candidates = [env.SHELL && path.posix.dirname(toPosix(env.SHELL)), env.EXEPATH].filter(
      Boolean,
    );
    for (const candidate of candidates) {
      const derived = deriveRoot(candidate);
      if (/^[A-Za-z]:\/./.test(derived) && fs.existsSync(derived)) {
        root = derived;
        break;
      }
    }
  }

  if (env === process.env) cachedRoot = root;
  return root;
}

/** Reset the memoized root. Tests only. */
function resetMsysRootCache() {
  cachedRoot = undefined;
}

/**
 * Strip the MSYS root prefix from `value`, restoring the leading `/` the shell ate.
 * Returns the value unchanged when it was not converted.
 */
function unmangleMsysValue(value, root = msysRoot()) {
  if (!root || typeof value !== 'string') return value;
  const prefix = `${root}/`;
  if (value.slice(0, prefix.length).toLowerCase() !== prefix.toLowerCase()) return value;
  return `/${value.slice(prefix.length)}`;
}

/** True when `value` looks like a path flag that MSYS conversion pointed at a file that is absent. */
function describeMangledFileArg(key, value, root = msysRoot()) {
  if (!root || typeof value !== 'string') return null;
  if (unmangleMsysValue(value, root) === value) return null;
  if (fs.existsSync(value)) return null;
  return (
    `--${key} points at "${value}", which does not exist.\n` +
    `  Git Bash rewrote a leading "/" into the MSYS root "${root}". Pass the file as a relative ` +
    'path ("./notes.md") or a Windows path ("C:/tmp/notes.md").'
  );
}

/**
 * Repair every value in `argv` that MSYS conversion corrupted, and refuse a path flag it broke.
 *
 * `onRepair` reports each repaired value, so a false positive is visible instead of silent.
 * `onReject` receives the explanation for a broken path flag; the caller routes it through `die`.
 */
function repairMsysArgv(argv, { onRepair, onReject, env, root = msysRoot(env) } = {}) {
  if (!root) return argv;

  const repaired = argv.slice();
  for (let i = 0; i < repaired.length - 1; i++) {
    const arg = repaired[i];
    if (typeof arg !== 'string' || !arg.startsWith('--') || arg === '--') continue;
    const key = arg.slice(2);
    const value = repaired[i + 1];

    if (PATH_FLAGS.has(key)) {
      const problem = describeMangledFileArg(key, value, root);
      if (problem) {
        if (onReject) onReject(problem);
        else throw new Error(problem);
      }
      continue;
    }

    const fixed = unmangleMsysValue(value, root);
    if (fixed !== value) {
      repaired[i + 1] = fixed;
      if (onRepair) onRepair(`--${key}: Git Bash rewrote the leading "/" — restored "${fixed}".`);
    }
  }
  return repaired;
}

module.exports = {
  PATH_FLAGS,
  msysRoot,
  resetMsysRootCache,
  unmangleMsysValue,
  describeMangledFileArg,
  repairMsysArgv,
};
