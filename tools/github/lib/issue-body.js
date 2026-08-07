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
 * Returns null for a body with no plan AND for a malformed/unbalanced pair — callers that would
 * destroy content on a false negative must check containsBarePlanMarker() themselves and refuse.
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
 * Replace the marker-delimited Implementation Plan section in an issue body, or append one if the
 * markers aren't present yet. Everything outside the markers is returned byte-for-byte.
 */
function spliceImplementationPlan(body, plan) {
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
 *   - the existing body's markers are unbalanced, so the block cannot be read back reliably.
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

  const block = findPlanBlock(existingBody);
  if (!block) {
    if (containsBarePlanMarker(existingBody)) {
      throw new Error(
        "The issue's existing Implementation Plan markers are unbalanced, so the plan block " +
          'cannot be located and preserved. Refusing to overwrite an engineer plan that cannot be ' +
          'read back — fix the markers on the issue first. Nothing was written.',
      );
    }
    return newBody;
  }

  const plan = existingBody.slice(block.start, block.end);
  return `${newBody.trimEnd()}\n\n${plan}\n`;
}

module.exports = {
  PLAN_START,
  PLAN_END,
  maskCode,
  findPlanBlock,
  containsBarePlanMarker,
  spliceImplementationPlan,
  replaceBodyPreservingPlan,
};
