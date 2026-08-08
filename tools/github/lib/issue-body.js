/**
 * Issue-body surgery for the ticket wrappers, and the single home for the Implementation Plan
 * markers.
 *
 * Two mirror-image operations share these constants deliberately:
 *   spliceImplementationPlan  — replace the plan, keep the surround byte-for-byte.
 *                               Engineer path: update-ticket-status.js --plan-file.
 *   replaceBodyPreservingPlan — replace the surround, keep the plan byte-for-byte.
 *                               Product-owner path: update-ticket-fields.js --body-file.
 * If the marker constants ever drifted apart, each path would silently start destroying the other's
 * section, so neither script defines them locally.
 *
 * Lookup is code-span aware, and that is load-bearing rather than fussy: a ticket that SPECIFIES
 * these markers quotes them in backticks, so a plain indexOf matches the quoted pair and splices the
 * plan into the middle of the prose — which is exactly how #35's own Acceptance Criteria got
 * destroyed. A bare marker is structure; a backticked or fenced one is prose.
 *
 * These functions are pure and throw on input they refuse; the scripts turn that into die().
 */

const PLAN_START = '<!-- implementation-plan:start -->';
const PLAN_END = '<!-- implementation-plan:end -->';

// Same discriminator, and the same reasoning, as MARKDOWN_CODE_SEGMENT in gh-client.js: backticks
// are where verbatim text belongs in Markdown. String.split() splits on every match of a capturing
// group regardless of /g, so the odd-indexed segments below are the captured code.
const MARKDOWN_CODE_SEGMENT = /(```[\s\S]*?```|`[^`\n]*`)/;

/**
 * Blank out code spans and fenced blocks, replacing each with spaces of the SAME length so every
 * index found in the masked copy is still valid in the original string. Cheaper and more predictable
 * than a Markdown parser, and only ever used for locating markers.
 */
function maskCode(text) {
  return text
    .split(MARKDOWN_CODE_SEGMENT)
    .map((segment, index) => (index % 2 === 1 ? ' '.repeat(segment.length) : segment))
    .join('');
}

/**
 * Locate the marker-delimited plan block, ignoring markers quoted in prose. `end` is exclusive, so
 * body.slice(start, end) is the whole block with both markers.
 *
 * Returns null for a body with no plan AND for a malformed/unbalanced/hidden pair — it cannot tell
 * "there is no plan" from "there is a plan I could not read". Callers that would destroy content on
 * a false negative must run assertLegiblePlanBlock() first, which separates the two and throws.
 */
function findPlanBlock(body) {
  const masked = maskCode(body);
  const start = masked.indexOf(PLAN_START);
  const end = masked.indexOf(PLAN_END);
  if (start !== -1 && end !== -1 && end > start) {
    return { start, end: end + PLAN_END.length };
  }
  return null;
}

/**
 * True if either marker appears as structure — outside any code span or fence. A backticked mention
 * is prose and must stay allowed: #35's own Acceptance Criteria quotes both markers, and a product
 * owner has to be able to submit that body through --body-file.
 */
function containsBarePlanMarker(text) {
  const masked = maskCode(text);
  return masked.includes(PLAN_START) || masked.includes(PLAN_END);
}

/**
 * Count lines that are nothing BUT `marker` (surrounding whitespace allowed). A marker on its own
 * line is structure; one mentioned mid-sentence is prose. Split on /\r?\n/ so a body fetched from
 * GitHub counts the same whether it came back with CRLF or LF endings.
 */
function countMarkerLines(text, marker) {
  return text.split(/\r?\n/).filter((line) => line.trim() === marker).length;
}

/**
 * maskCode pairs ``` delimiters greedily left to right, so an UNCLOSED fence silently pairs with a
 * later one and blanks everything between them — real plan markers included. An odd number of ```
 * delimiters is the tell. When the fences don't balance, the mask is not trustworthy and the guard
 * below reads the body raw instead: refusing a body we cannot parse beats concluding "no plan here"
 * and overwriting one.
 */
function fencesBalanced(text) {
  return (text.match(/```/g) || []).length % 2 === 0;
}

/**
 * The one legibility guard both editing paths run before touching a body.
 *
 * findPlanBlock() returns null for two very different situations — "there is no plan" and "there is
 * a plan but I could not read it" — and every caller used to treat the second as the first, then
 * silently destroy content: --plan-file appended a second block next to a stray marker and the run
 * after that spliced across the product owner's sections; --body-file dropped a plan hidden by a
 * runaway fence. The invariant that separates them: if a body contains structural plan markers at
 * all, there must be exactly ONE legible pair.
 *
 * Throws (never exits) with an actionable message naming which of the three failures it is. The
 * scripts turn that into die(); nothing is ever written on a throw.
 */
function assertLegiblePlanBlock(body) {
  const scanned = fencesBalanced(body) ? maskCode(body) : body;
  const starts = countMarkerLines(scanned, PLAN_START);
  const ends = countMarkerLines(scanned, PLAN_END);

  if (starts === 0 && ends === 0) {
    // No structural markers. Either genuinely no plan, or a marker sitting inline — which is only
    // safe if it still forms a pair findPlanBlock can read back.
    const anyMarker = scanned.includes(PLAN_START) || scanned.includes(PLAN_END);
    if (!anyMarker || findPlanBlock(body)) return;
    throw new Error(
      `The issue body contains an Implementation Plan marker (${PLAN_START} / ${PLAN_END}) that is ` +
        'neither on a line of its own nor part of a readable pair, so the plan block cannot be ' +
        'located. Put each marker alone on its own line, or quote it in backticks if it is meant ' +
        'as prose. Nothing was written.',
    );
  }

  if (starts !== 1 || ends !== 1) {
    throw new Error(
      `The issue's Implementation Plan markers are unbalanced: ${starts} \`${PLAN_START}\` ` +
        `line(s) and ${ends} \`${PLAN_END}\` line(s), where exactly one of each is required. ` +
        'Editing the body would splice across the wrong span and destroy content — fix the markers ' +
        'on the issue by hand first. Nothing was written.',
    );
  }

  if (!findPlanBlock(body)) {
    throw new Error(
      "The issue's Implementation Plan markers are present but unreadable — either an unclosed " +
        `code fence hides them, or ${PLAN_END} comes before ${PLAN_START}. The plan block cannot ` +
        'be located, so editing the body would destroy content. Fix the markers (and any unclosed ' +
        '``` fence) on the issue by hand first. Nothing was written.',
    );
  }
}

/**
 * Replace the marker-delimited Implementation Plan section in an issue body, or append one if the
 * markers aren't present yet. Everything outside the markers is returned byte-for-byte.
 *
 * Refuses a body whose markers cannot be read back as exactly one pair. Appending a fresh block
 * next to a stray marker used to "work" (exit 0, plausible output) and left the body with two
 * starts and one end, so the NEXT --plan-file run spliced from the stray marker to the real end and
 * deleted everything in between — the product owner's Technical Notes included.
 */
function spliceImplementationPlan(body, plan) {
  assertLegiblePlanBlock(body);

  const section = `${PLAN_START}\n\n## Implementation Plan\n\n${plan}\n\n${PLAN_END}`;
  const block = findPlanBlock(body);
  if (block) {
    return body.slice(0, block.start) + section + body.slice(block.end);
  }
  return `${body.trimEnd()}\n\n${section}\n`;
}

/**
 * Replace the product owner's content (Problem / Acceptance Criteria / Technical Notes) while
 * carrying the engineer's marker-delimited plan block over byte-for-byte, appended after the new
 * content.
 *
 * Refuses two cases rather than guessing, because both would destroy execution state:
 *   - the incoming body carries a marker itself (a product owner authoring/overwriting the plan);
 *   - the existing body's markers cannot be read back as exactly one legible pair
 *     (assertLegiblePlanBlock), so the plan would be dropped on the floor.
 *
 * Content in the existing body AFTER the plan block is deliberately dropped: the product owner's
 * file is the whole of the product owner's content, and the plan is re-appended at the end.
 */
function replaceBodyPreservingPlan(existingBody, newBody) {
  if (containsBarePlanMarker(newBody)) {
    throw new Error(
      'The new body contains an Implementation Plan marker ' +
        `(${PLAN_START} / ${PLAN_END}). That section is the engineer's execution state and is ` +
        'carried over automatically — remove the markers and everything between them from your ' +
        'file. Nothing was written.',
    );
  }

  assertLegiblePlanBlock(existingBody);

  const block = findPlanBlock(existingBody);
  if (!block) return newBody;

  const plan = existingBody.slice(block.start, block.end);
  return `${newBody.trimEnd()}\n\n${plan}\n`;
}

module.exports = {
  PLAN_START,
  PLAN_END,
  maskCode,
  findPlanBlock,
  containsBarePlanMarker,
  assertLegiblePlanBlock,
  spliceImplementationPlan,
  replaceBodyPreservingPlan,
};
