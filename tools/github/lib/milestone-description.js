/**
 * Rendering and validation of a milestone description.
 *
 * A milestone is an epic, and its description is the durable release-direction record: the first
 * line is a release marker (`Release: MVP` or `Release: post-MVP`), and the set of `Release: MVP`
 * epics is the current first-release scope. See AGENTS.md -> Product Backlog -> Milestones.
 *
 * `gh:milestone -- list` therefore has to print the text back. A product owner that cannot read the
 * marker re-derives release direction from scratch every session.
 */

/** The first line of a description. `Release:` then a non-empty word. */
const RELEASE_MARKER = /^Release:\s*\S/;

/** Lines of description printed by `list` before it truncates. `--full` prints all of them. */
const PREVIEW_LINES = 10;

const INDENT = '    ';

/** Split on either line ending, so a CRLF description from the API reads the same as an LF one. */
const toLines = (description) => String(description).replace(/\r\n/g, '\n').split('\n');

/** `null`, `undefined` and whitespace all mean the same thing: the epic has no direction recorded. */
const isEmpty = (description) => !description || !String(description).trim();

/**
 * The problem with this description, or `null` when it is well-formed.
 * Both cases cost the same thing — the release marker cannot be read.
 */
function releaseMarkerProblem(description) {
  if (isEmpty(description)) {
    return 'no description — the release marker is missing (first line must be "Release: MVP" or "Release: post-MVP")';
  }
  const first = toLines(description).find((line) => line.trim() !== '');
  if (!RELEASE_MARKER.test(first.trim())) {
    return `first line is not a release marker (found "${first.trim()}")`;
  }
  return null;
}

/**
 * The indented description block for one milestone, as an array of lines.
 * Returns `[]` when there is nothing to print, so the caller prints only the warning.
 */
function formatDescription(description, { full = false, previewLines = PREVIEW_LINES } = {}) {
  if (isEmpty(description)) return [];
  const lines = toLines(description);
  if (full || lines.length <= previewLines) return lines.map((line) => INDENT + line);

  const hidden = lines.length - previewLines;
  return [
    ...lines.slice(0, previewLines).map((line) => INDENT + line),
    `${INDENT}… ${hidden} more line(s) — run with --full`,
  ];
}

/** The description that `--append` produces. One blank line separates the old text from the new. */
function appendDescription(previous, addition) {
  if (isEmpty(previous)) return addition;
  return `${String(previous).replace(/\s+$/, '')}\n\n${addition}`;
}

module.exports = {
  RELEASE_MARKER,
  PREVIEW_LINES,
  INDENT,
  isEmpty,
  releaseMarkerProblem,
  formatDescription,
  appendDescription,
};
