const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PLAN_START,
  PLAN_END,
  maskCode,
  findPlanBlock,
  spliceImplementationPlan,
  containsBarePlanMarker,
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
