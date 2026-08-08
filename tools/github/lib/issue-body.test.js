const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PLAN_START,
  PLAN_END,
  maskCode,
  findPlanBlock,
  spliceImplementationPlan,
  containsBarePlanMarker,
  assertLegiblePlanBlock,
  replaceBodyPreservingPlan,
} = require('./issue-body');

/**
 * A plan block with everything that has to survive verbatim: checked and unchecked items, nested
 * items, a fenced code block, and blank lines.
 */
const PLAN_BLOCK = [
  PLAN_START,
  '',
  '## Implementation Plan',
  '',
  '- [x] **Task 1: schema** — landed in `a1d7004`',
  '  - [x] nested done',
  '  - [ ] nested pending',
  '- [ ] **Task 2: endpoints**',
  '',
  '```bash',
  'pnpm exec nx test property-service',
  '```',
  '',
  PLAN_END,
].join('\n');

const PO_BODY = [
  '## Problem',
  '',
  'Search is client-side only.',
  '',
  '## Acceptance Criteria',
  '',
  '- `GET /listings` works',
  '',
].join('\n');

test('findPlanBlock returns the span of the whole block, markers included', () => {
  const body = `${PO_BODY}\n${PLAN_BLOCK}\n`;
  const block = findPlanBlock(body);
  assert.notEqual(block, null);
  assert.equal(body.slice(block.start, block.end), PLAN_BLOCK);
});

test('findPlanBlock returns null when there is no plan', () => {
  assert.equal(findPlanBlock(PO_BODY), null);
});

test('findPlanBlock returns null for an unbalanced pair (start only)', () => {
  assert.equal(findPlanBlock(`${PO_BODY}\n${PLAN_START}\ntruncated`), null);
});

test('spliceImplementationPlan replaces the plan and leaves the surround byte-for-byte', () => {
  const body = `${PO_BODY}\n${PLAN_BLOCK}\n\n## Technical Notes\n\nSee the view.\n`;
  const updated = spliceImplementationPlan(body, '- [ ] **Task 1: rewritten**');

  assert.ok(updated.startsWith(PO_BODY));
  assert.ok(updated.endsWith('\n\n## Technical Notes\n\nSee the view.\n'));
  assert.ok(updated.includes('- [ ] **Task 1: rewritten**'));
  assert.ok(!updated.includes('Task 2: endpoints'));
  // Exactly one marker pair — no duplicate section appended.
  assert.equal(updated.split(PLAN_START).length - 1, 1);
  assert.equal(updated.split(PLAN_END).length - 1, 1);
});

test('spliceImplementationPlan appends a section when the body has no plan', () => {
  const updated = spliceImplementationPlan(PO_BODY, '- [ ] **Task 1: first**');
  assert.ok(updated.startsWith(PO_BODY.trimEnd()));
  assert.ok(
    updated.includes(
      `${PLAN_START}\n\n## Implementation Plan\n\n- [ ] **Task 1: first**\n\n${PLAN_END}`,
    ),
  );
});

test('containsBarePlanMarker ignores markers inside code spans and fences', () => {
  assert.equal(containsBarePlanMarker(PO_BODY), false);
  assert.equal(containsBarePlanMarker(`text ${PLAN_START} text`), true);
  assert.equal(containsBarePlanMarker(`text ${PLAN_END} text`), true);
  assert.equal(containsBarePlanMarker(`quoted \`${PLAN_START}\` in prose`), false);
  assert.equal(containsBarePlanMarker(['```html', PLAN_START, '```'].join('\n')), false);
});

test('maskCode preserves length so indices map back to the original', () => {
  const text = `a \`${PLAN_START}\` b`;
  assert.equal(maskCode(text).length, text.length);
  assert.ok(!maskCode(text).includes(PLAN_START));
});

/**
 * Regression: writing a plan to #35 corrupted it. That ticket's Acceptance Criteria quotes both
 * markers in backticks (it specifies them), so a plain indexOf matched the QUOTED pair and the
 * splice replaced the AC prose between them with the checklist.
 */
test('findPlanBlock ignores markers quoted in the product owner prose', () => {
  const ac = [
    '## Acceptance Criteria',
    '',
    '- If the existing body contains',
    `  \`${PLAN_START}\` … \`${PLAN_END}\`, that block is carried over.`,
    '',
  ].join('\n');

  assert.equal(findPlanBlock(ac), null);
});

test('findPlanBlock finds the real block in a body that also quotes the markers', () => {
  const ac = `## Acceptance Criteria\n\n- \`${PLAN_START}\` … \`${PLAN_END}\` is preserved.\n`;
  const body = `${ac}\n${PLAN_BLOCK}\n`;
  const block = findPlanBlock(body);

  assert.notEqual(block, null);
  assert.equal(body.slice(block.start, block.end), PLAN_BLOCK);
});

test('spliceImplementationPlan leaves quoted markers in the prose untouched', () => {
  const ac = `## Acceptance Criteria\n\n- \`${PLAN_START}\` … \`${PLAN_END}\` is preserved.\n`;
  const updated = spliceImplementationPlan(`${ac}\n${PLAN_BLOCK}\n`, '- [ ] **Task 1: new**');

  assert.ok(updated.startsWith(ac), 'the AC prose must survive byte-for-byte');
  assert.ok(updated.includes('- [ ] **Task 1: new**'));
  assert.ok(!updated.includes('Task 2: endpoints'));
});

const REVISED_PO_BODY = ['## Problem', '', 'Corrected: query listing_search_v.', ''].join('\n');

test('replaceBodyPreservingPlan carries the plan block over byte-for-byte', () => {
  const existing = `${PO_BODY}\n${PLAN_BLOCK}\n`;
  const updated = replaceBodyPreservingPlan(existing, REVISED_PO_BODY);

  // The engineer's execution state survives with zero character changes.
  assert.ok(updated.includes(PLAN_BLOCK));
  const block = findPlanBlock(updated);
  assert.equal(updated.slice(block.start, block.end), PLAN_BLOCK);

  // ...and it lands at the end of the new product-owner content.
  assert.equal(updated, `${REVISED_PO_BODY.trimEnd()}\n\n${PLAN_BLOCK}\n`);

  // The stale spec is gone.
  assert.ok(!updated.includes('Search is client-side only.'));
  assert.ok(updated.includes('Corrected: query listing_search_v.'));
});

test('replaceBodyPreservingPlan replaces as-is when the existing body has no plan', () => {
  const updated = replaceBodyPreservingPlan(PO_BODY, REVISED_PO_BODY);
  assert.equal(updated, REVISED_PO_BODY); // byte-identical, no markers injected
  assert.equal(containsBarePlanMarker(updated), false);
});

test('replaceBodyPreservingPlan refuses an incoming body containing the start marker', () => {
  assert.throws(
    () => replaceBodyPreservingPlan(PO_BODY, `${REVISED_PO_BODY}\n${PLAN_START}\n- [ ] mine\n`),
    /Implementation Plan marker/,
  );
});

test('replaceBodyPreservingPlan refuses an incoming body containing the end marker', () => {
  assert.throws(
    () => replaceBodyPreservingPlan(PO_BODY, `${REVISED_PO_BODY}\n${PLAN_END}\n`),
    /Implementation Plan marker/,
  );
});

test('replaceBodyPreservingPlan refuses to overwrite when the existing markers are unbalanced', () => {
  assert.throws(
    () => replaceBodyPreservingPlan(`${PO_BODY}\n${PLAN_START}\n- [ ] truncated`, REVISED_PO_BODY),
    /unbalanced/,
  );
});

/**
 * The product owner must be able to submit a spec that DOCUMENTS the markers — #35's own Acceptance
 * Criteria does exactly that. Only a bare marker is an attempt to author the plan.
 */
test('replaceBodyPreservingPlan accepts an incoming body that only quotes the markers', () => {
  const spec = `## Acceptance Criteria\n\n- \`${PLAN_START}\` … \`${PLAN_END}\` is preserved.\n`;
  const updated = replaceBodyPreservingPlan(`${PO_BODY}\n${PLAN_BLOCK}\n`, spec);

  assert.ok(updated.startsWith(spec.trimEnd()));
  assert.equal(updated, `${spec.trimEnd()}\n\n${PLAN_BLOCK}\n`);
});

/**
 * Contract, not an accident: --body-file submits the WHOLE of the product owner's content, so
 * anything the old body carried after the plan block is stale product-owner prose and goes. Pinned
 * because a future "the plan should stay where it was" fix would silently resurrect it.
 */
test('replaceBodyPreservingPlan drops existing content after the plan block, by design', () => {
  const existing = `${PO_BODY}\n${PLAN_BLOCK}\n\n## Technical Notes\n\nStale trailing note.\n`;
  const updated = replaceBodyPreservingPlan(existing, REVISED_PO_BODY);

  assert.ok(!updated.includes('Stale trailing note.'));
  assert.equal(updated, `${REVISED_PO_BODY.trimEnd()}\n\n${PLAN_BLOCK}\n`);
});

/**
 * The live acceptance check that was run against issue #35 itself: re-submitting a ticket's own
 * product-owner half must be a byte-for-byte no-op. Anything else means one of the two paths is
 * quietly rewriting the other's content.
 */
test('a no-op product-owner round-trip is byte-identical', () => {
  const original = `${PO_BODY}\n${PLAN_BLOCK}\n`;
  const productOwnerHalf = original.slice(0, findPlanBlock(original).start);

  assert.equal(replaceBodyPreservingPlan(original, productOwnerHalf), original);
});

test('splice → replaceBody → splice → replaceBody keeps exactly one pair and both owners intact', () => {
  const firstPlan = '- [ ] **Task 1: schema**\n- [ ] **Task 2: endpoints**';
  const secondPlan = [
    '- [x] **Task 1: schema** — landed in `a1d7004`',
    '  - [x] nested done',
    '- [ ] **Task 2: endpoints**',
  ].join('\n');
  const FINAL_PO_BODY = ['## Problem', '', 'Final: listing_search_v, ranked.', ''].join('\n');

  // Engineer writes a plan, PO corrects the spec, engineer ticks items off, PO corrects again.
  let body = spliceImplementationPlan(PO_BODY, firstPlan);
  body = replaceBodyPreservingPlan(body, REVISED_PO_BODY);
  body = spliceImplementationPlan(body, secondPlan);
  body = replaceBodyPreservingPlan(body, FINAL_PO_BODY);

  assert.equal(body.split(PLAN_START).length - 1, 1, 'exactly one start marker');
  assert.equal(body.split(PLAN_END).length - 1, 1, 'exactly one end marker');

  // The engineer's execution state survived every product-owner rewrite, verbatim.
  assert.ok(body.includes(secondPlan));

  // ...and only the newest product-owner spec is left.
  assert.ok(body.includes('Final: listing_search_v, ranked.'));
  assert.ok(!body.includes('Corrected: query listing_search_v.'));
  assert.ok(!body.includes('Search is client-side only.'));
  assert.ok(!body.includes('Task 1: schema**\n- [ ] **Task 2'), 'the superseded plan is gone');
});

/**
 * Finding 1. A body with a stray start and no end used to make spliceImplementationPlan APPEND a
 * second block (exit 0, "✓ Implementation Plan section updated"), leaving 2 starts / 1 end — and the
 * next --plan-file run spliced from the stray start to the real end, deleting the Technical Notes.
 */
test('spliceImplementationPlan refuses a body with a stray start marker and no end', () => {
  const stray = `## Problem\n\nP text\n\n${PLAN_START}\n\n## Technical Notes\n\nTN that matters\n`;

  assert.throws(
    () => spliceImplementationPlan(stray, '- [ ] task A'),
    /unbalanced: 1 .* line\(s\) and 0 .* line\(s\)[\s\S]*Nothing was written\./,
  );
});

test('spliceImplementationPlan refuses a body that already has two start markers', () => {
  const doubled = `${PO_BODY}\n${PLAN_START}\n\n${PLAN_BLOCK}\n`;

  assert.throws(() => spliceImplementationPlan(doubled, '- [ ] task A'), /unbalanced: 2 /);
});

test('replaceBodyPreservingPlan refuses a body with a duplicated marker rather than picking one', () => {
  const doubled = `${PO_BODY}\n${PLAN_START}\n\n${PLAN_BLOCK}\n`;

  assert.throws(() => replaceBodyPreservingPlan(doubled, REVISED_PO_BODY), /unbalanced: 2 /);
});

/**
 * Finding 2. An unclosed fence pairs with a later one, so maskCode blanks the span that happens to
 * contain both real markers: findPlanBlock → null AND containsBarePlanMarker → false, and
 * replaceBodyPreservingPlan took its "no plan here" branch and returned the new body — silently
 * deleting the engineer's plan, with only a missing "(Implementation Plan preserved)" as a signal.
 */
test('replaceBodyPreservingPlan refuses when an unclosed fence hides the plan block', () => {
  const hidden = [
    '## Problem',
    '',
    '```text',
    'unclosed fence starts here',
    '',
    PLAN_BLOCK,
    '',
    '## Notes',
    '',
    '```',
    'trailing fenced snippet',
    '```',
    '',
  ].join('\n');

  // The precondition that made this destructive: neither existing signal sees the plan.
  assert.equal(findPlanBlock(hidden), null);
  assert.equal(containsBarePlanMarker(hidden), false);

  assert.throws(
    () => replaceBodyPreservingPlan(hidden, REVISED_PO_BODY),
    /present but unreadable[\s\S]*Nothing was written\./,
  );
});

test('spliceImplementationPlan refuses the same fence-hidden body', () => {
  const hidden = `## Problem\n\n\`\`\`text\nunclosed\n\n${PLAN_BLOCK}\n\n\`\`\`\nsnippet\n\`\`\`\n`;

  assert.throws(() => spliceImplementationPlan(hidden, '- [ ] task A'), /present but unreadable/);
});

test('assertLegiblePlanBlock refuses an end marker that precedes the start marker', () => {
  const inverted = `${PO_BODY}\n${PLAN_END}\n\n## Implementation Plan\n\n${PLAN_START}\n`;

  assert.throws(() => assertLegiblePlanBlock(inverted), /present but unreadable/);
});

test('assertLegiblePlanBlock refuses a bare marker that is not on a line of its own', () => {
  assert.throws(
    () => assertLegiblePlanBlock(`${PO_BODY}\nsee ${PLAN_START} for the plan\n`),
    /neither on a line of its own nor part of a readable pair/,
  );
});

test('assertLegiblePlanBlock accepts the bodies a healthy workflow produces', () => {
  // A brand-new ticket, a ticket right after its first --plan-file, and one with a plan and prose
  // on both sides of it.
  assert.doesNotThrow(() => assertLegiblePlanBlock(PO_BODY));
  assert.doesNotThrow(() => assertLegiblePlanBlock(spliceImplementationPlan(PO_BODY, '- [ ] a')));
  assert.doesNotThrow(() =>
    assertLegiblePlanBlock(`${PO_BODY}\n${PLAN_BLOCK}\n\n## Technical Notes\n\nSee the view.\n`),
  );
  assert.doesNotThrow(() => assertLegiblePlanBlock(''));
});

/** A body fetched from GitHub can come back with CRLF endings; markers are still structure. */
test('assertLegiblePlanBlock counts marker lines the same with CRLF endings', () => {
  const crlf = `${PO_BODY}\n${PLAN_BLOCK}\n`.replace(/\n/g, '\r\n');
  assert.doesNotThrow(() => assertLegiblePlanBlock(crlf));

  const strayCrlf = `## Problem\r\n\r\n${PLAN_START}\r\n\r\n## Technical Notes\r\n\r\nTN\r\n`;
  assert.throws(() => assertLegiblePlanBlock(strayCrlf), /unbalanced/);
});

/**
 * CONTROL, non-negotiable: #35's own Acceptance Criteria quotes both markers, and the whole
 * code-span-aware lookup exists so that body can go through --body-file. If the legibility guard
 * ever rejects it, the guard is wrong.
 */
test('a #35-style body that quotes both markers is accepted by both paths', () => {
  const ac = [
    '## Acceptance Criteria',
    '',
    `- \`${PLAN_START}\` … \`${PLAN_END}\` is preserved byte-for-byte.`,
    '',
  ].join('\n');

  assert.doesNotThrow(() => assertLegiblePlanBlock(ac));
  assert.doesNotThrow(() => spliceImplementationPlan(ac, '- [ ] task A'));
  assert.doesNotThrow(() => replaceBodyPreservingPlan(PO_BODY, ac));

  // ...and with a real plan alongside the quoted mention, the plan still round-trips.
  const kept = replaceBodyPreservingPlan(`${ac}\n${PLAN_BLOCK}\n`, REVISED_PO_BODY);
  assert.equal(kept, `${REVISED_PO_BODY.trimEnd()}\n\n${PLAN_BLOCK}\n`);
});

/**
 * The same control one step further: a spec (or a plan) that documents the markers in a FENCED
 * example, not just inline backticks. The fences balance, so the mask is trustworthy and those
 * marker lines are prose.
 */
test('markers shown in a balanced fenced example are prose, not structure', () => {
  const fencedExample = [
    '## Technical Notes',
    '',
    'The block looks like this:',
    '',
    '```markdown',
    PLAN_START,
    '',
    '## Implementation Plan',
    '',
    PLAN_END,
    '```',
    '',
  ].join('\n');

  assert.doesNotThrow(() => assertLegiblePlanBlock(fencedExample));
  assert.doesNotThrow(() => replaceBodyPreservingPlan(PO_BODY, fencedExample));

  // A real plan next to the fenced example is still found, and only it is replaced.
  const withPlan = `${fencedExample}\n${PLAN_BLOCK}\n`;
  const updated = spliceImplementationPlan(withPlan, '- [ ] **Task 1: new**');
  assert.ok(updated.startsWith(fencedExample), 'the fenced example survives byte-for-byte');
  assert.ok(updated.includes('- [ ] **Task 1: new**'));
  assert.equal(updated.split('## Implementation Plan').length - 1, 2, 'example + real section');
});
