/**
 * Pure helpers that make the setup scripts idempotent. They read state and decide. They write
 * nothing, so tests run them without PowerShell or a registry.
 */

/** Normalize a PATH entry: trim, drop trailing slashes, compare case-insensitively by default. */
function normalizeEntry(entry, caseInsensitive = true) {
  const trimmed = String(entry)
    .trim()
    .replace(/[\\/]+$/, '');
  return caseInsensitive ? trimmed.toLowerCase() : trimmed;
}

/** Split a PATH string into non-empty entries. */
function splitPath(pathValue, delimiter) {
  return String(pathValue || '')
    .split(delimiter)
    .map((e) => e.trim())
    .filter(Boolean);
}

/**
 * Return the directories that must be added to PATH. Return an empty array when nothing is missing.
 * A candidate is skipped when it is already on PATH, when its directory is absent, or when its
 * `tool` already resolves from another PATH entry.
 *
 * @param {object} opts
 * @param {string} opts.pathValue          The PATH value to compare against.
 * @param {string} opts.delimiter          `;` on Windows, `:` elsewhere.
 * @param {{dir: string, tool?: string}[]} opts.candidates
 * @param {(dir: string) => boolean} opts.dirExists
 * @param {(tool: string) => boolean} [opts.resolves]  True when the tool already resolves.
 * @param {boolean} [opts.caseInsensitive]
 */
function computeMissingPathEntries({
  pathValue,
  delimiter,
  candidates,
  dirExists,
  resolves = () => false,
  caseInsensitive = true,
}) {
  const present = new Set(
    splitPath(pathValue, delimiter).map((e) => normalizeEntry(e, caseInsensitive)),
  );
  const missing = [];
  for (const { dir, tool } of candidates) {
    const key = normalizeEntry(dir, caseInsensitive);
    if (present.has(key)) continue;
    if (!dirExists(dir)) continue;
    if (tool && resolves(tool)) continue;
    missing.push(dir);
    present.add(key);
  }
  return missing;
}

/** Parse `dotnet tool list --global` output into lowercase package ids. */
function parseGlobalToolList(output) {
  return String(output || '')
    .split(/\r?\n/)
    .slice(2)
    .map((line) => line.trim().split(/\s+/)[0])
    .filter(Boolean)
    .map((id) => id.toLowerCase());
}

/** Return the wanted tools that are not installed. Each tool has a `name`. */
function computeMissingTools(listOutput, wanted) {
  const installed = new Set(parseGlobalToolList(listOutput));
  return wanted.filter((tool) => !installed.has(tool.name.toLowerCase()));
}

module.exports = {
  normalizeEntry,
  splitPath,
  computeMissingPathEntries,
  parseGlobalToolList,
  computeMissingTools,
};
