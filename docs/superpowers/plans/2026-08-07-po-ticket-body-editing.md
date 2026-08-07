# Product-Owner Ticket Body & Label Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the product owner `--body-file`, `--add-label` and `--remove-label` on
`gh:ticket:update-fields` so a ticket's spec can be corrected after creation, without ever
disturbing the engineer's `## Implementation Plan` block.

**Architecture:** The two body operations are mirror images — the engineer path replaces the plan
and keeps the surround (`spliceImplementationPlan`, exists today in `update-ticket-status.js`); the
new product-owner path replaces the surround and keeps the plan. Both are moved/added to one new
pure module, `tools/github/lib/issue-body.js`, so the marker constants cannot drift apart and start
destroying each other's section. Marker _lookup_ in that module is code-span aware: a bare marker is
structure, a backticked or fenced one is prose (see the constraint below). The temp-file
`gh issue edit --body-file` dance is lifted out of `update-ticket-status.js` into a shared
`ghEditBody()` in `gh-client.js`. The pure functions throw; the scripts convert that to `die()`.

**Tech Stack:** Node 20 CommonJS, `gh` CLI, Node's built-in `node:test` + `node:assert` runner (no
new dependencies). Ticket: [#35](https://github.com/jmbilizi/real-estate-platform/issues/35).

## Global Constraints

- Branch `35-ticket-body-edit-flags`, cut from `dev`. One PR targeting `dev`, titled
  `#35 chore(tools): ...` with `Closes #35` in the body.
- **No new dependencies.** `tools/` is not an Nx project and no test runner covers it today; use
  `node --test`, which ships with the Node this repo already requires.
- **Cross-platform.** No bash-only or `.bat`-only anything; `node --test <dir>` recursion is
  verified working on Windows in this repo's Node 20.19.5.
- **Never run raw tool commands.** `pnpm run ...` / `pnpm exec nx ...` wrappers only. Never
  `--no-verify`, never force-push.
- Prettier owns formatting for `.js`/`.md`: run `pnpm run nx:workspace-format` before each commit.
- Commit style matches recent history: `#35 <type>(<scope>): <subject>`.
- `update-ticket-status.js` keeps its exact current privileges (Status + assignee/comment + plan
  section only) and keeps exporting `spliceImplementationPlan`. Its tolerant handling of an
  unbalanced marker pair (treat as "no plan yet", append) must not change — only the new destructive
  path is strict.
- Every `gh` mutation in this ticket is preceded by full validation: a rejected `--body-file` must
  leave the ticket completely untouched, **fields included**.
- **Marker lookup must ignore code spans and fenced blocks — this is a live bug, not a nicety.**
  Writing this plan to #35 with `gh:ticket:update-status -- --plan-file` corrupted the ticket:
  `spliceImplementationPlan` uses a plain `indexOf`, #35's Acceptance Criteria necessarily _quotes_
  both markers in backticks, so the splice matched the quoted pair and replaced the AC text between
  them with the checklist. The body was restored by hand (one authorized raw `gh issue edit`, the
  only one in this ticket). Consequences for the design:
  - `findPlanBlock` must locate only a **bare** marker pair, or `--plan-file` keeps corrupting any
    ticket that documents the markers — including #35 itself.
  - The AC's "fails if the **incoming** `--body-file` contains either plan marker" means a bare
    marker. A backticked mention must be allowed, otherwise #35's own AC could never be submitted
    through the very flag it specifies.
  - Reuse the repo's existing precedent rather than inventing one: `MARKDOWN_CODE_SEGMENT` in
    `tools/github/lib/gh-client.js:193`, which solves the same class of bug (backticks as the
    discriminator between prose and verbatim text) for `\n` in Windows paths.
- **Do not run `gh:ticket:update-status -- --plan-file --issue 35` until Task 1 lands.** On today's
  code it re-corrupts #35's Acceptance Criteria, because the body now contains both the quoted pair
  (in the AC) and the real block (at the end), and `indexOf` finds the quoted one first. Keep the
  checklist file up to date locally and push it to the ticket at Task 1 Step 8, which is also the
  verification that the fix works.

---

### Task 1: Shared issue-body module + a test runner for `tools/`

Moves the existing plan-splice logic and its markers into one module, stands up the test harness the
rest of the plan needs, and fixes the code-span blindness that corrupted #35 (see Global
Constraints). Everything else about `--plan-file` behaves exactly as before.

**Files:**

- Create: `tools/github/lib/issue-body.js`
- Create: `tools/github/lib/issue-body.test.js`
- Modify: `tools/github/update-ticket-status.js:37-52` (delete the local markers + function, import
  instead) and `:138` (re-export)
- Modify: `package.json` (add `tools:test` to the "GitHub Tickets" script block)

**Interfaces:**

- Consumes: nothing.
- Produces: `tools/github/lib/issue-body.js` exporting `PLAN_START: string`, `PLAN_END: string`,
  `maskCode(text: string) => string`,
  `findPlanBlock(body: string) => { start: number, end: number } | null`,
  `spliceImplementationPlan(body: string, plan: string) => string`,
  `containsBarePlanMarker(text: string) => boolean`. `end` is exclusive (already past `PLAN_END`),
  so `body.slice(start, end)` is the whole block including both markers. `maskCode` blanks code
  spans and fenced blocks **preserving length**, so indices found in the masked copy are valid in
  the original — that is what makes the lookups code-span aware without a parser.

- [ ] **Step 1: Write the failing test**

Create `tools/github/lib/issue-body.test.js`:

````js
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
````

- [ ] **Step 2: Add the `tools:test` script so the test can be run**

In `package.json`, inside the `// GitHub Tickets (Product Owner → Engineer handoff)` block, after
`"gh:session-brief"`:

```json
    "// → Unit tests for tools/ (node:test; tools/ is not an Nx project):": "",
    "tools:test": "node --test tools",
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm run tools:test` Expected: FAIL — `Cannot find module './issue-body'`.

- [ ] **Step 4: Create the module**

Create `tools/github/lib/issue-body.js`:

````js
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

module.exports = {
  PLAN_START,
  PLAN_END,
  maskCode,
  findPlanBlock,
  containsBarePlanMarker,
  spliceImplementationPlan,
};
```

Note this makes Task 1 a **behaviour change**, not a pure refactor: `--plan-file` stops matching
quoted markers. That is the bug fix, and the two regression tests above are its gate.`

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm run tools:test` Expected: PASS — 10 tests, 0 fail.

- [ ] **Step 6: Point `update-ticket-status.js` at the shared module**

In `tools/github/update-ticket-status.js`, delete the local `PLAN_START`/`PLAN_END` constants and
the `spliceImplementationPlan` function (lines 37–52), and add the import after the `gh-client`
require block:

```js
const { spliceImplementationPlan } = require('./lib/issue-body');
```

Keep the bottom of the file exactly as it is — `module.exports = { spliceImplementationPlan };` now
re-exports the shared implementation, so any existing importer is unaffected.

- [ ] **Step 7: Verify nothing regressed**

Run: `pnpm run tools:test` Expected: PASS — 10 tests.

Run: `pnpm run gh:ticket:update-status -- --issue 35` Expected: FAIL fast with
`✗ Provide at least one of --status, --claim, --comment, --plan-file` — proves the script still
loads and its guard is intact, without mutating anything.

- [ ] **Step 8: Verify the fix on the ticket that exposed it**

This is the first `--plan-file` write to #35 since the fix, and #35 is the exact adversarial case: its
Acceptance Criteria quotes both markers, and its real plan block sits at the end of the body. Capture
the body first so the check is a diff, not an eyeball:

```bash
export SP="C:/Users/jmbilizi/AppData/Local/Temp/claude/C--Src-real-estate-platform/a89192b7-dc51-4aa0-82cb-b03cde6cf2fd/scratchpad"
gh issue view 35 --repo jmbilizi/real-estate-platform --json body -q .body > "$SP/35-pre-task1.md"
pnpm run gh:ticket:update-status -- --issue 35 --plan-file ./docs/superpowers/plans/2026-08-07-po-ticket-body-editing-checklist.md
gh issue view 35 --repo jmbilizi/real-estate-platform --json body -q .body > "$SP/35-post-task1.md"
diff "$SP/35-pre-task1.md" "$SP/35-post-task1.md"
```

Expected: the diff touches **only** lines inside the plan block at the end of the body (item 1/2
wording and any ticked checkboxes). The Acceptance Criteria bullet
`` `<!-- implementation-plan:start -->` … `<!-- implementation-plan:end -->`, that block (markers ``
must be **absent from the diff entirely**. If it appears, the masking is not working — stop and fix
Task 1 before going further. (The two `gh issue view` calls are read-only verification probes, not
board operations.)

- [ ] **Step 9: Format and commit**

```bash
pnpm run nx:workspace-format
git add tools/github/lib/issue-body.js tools/github/lib/issue-body.test.js tools/github/update-ticket-status.js package.json
git commit -m "#35 fix(tools): stop matching plan markers quoted in prose, extract issue-body helpers"
```

---

### Task 2: `replaceBodyPreservingPlan` — replace the surround, keep the plan

The inverse operation, and the only new logic in this ticket. Pure module change; no script wiring
yet.

**Files:**

- Modify: `tools/github/lib/issue-body.js` (add one function + export)
- Modify: `tools/github/lib/issue-body.test.js` (append tests)

**Interfaces:**

- Consumes: `PLAN_START`, `PLAN_END`, `findPlanBlock`, `containsBarePlanMarker` from Task 1.
- Produces: `replaceBodyPreservingPlan(existingBody: string, newBody: string) => string`. Throws
  `Error` when `newBody` contains either marker, and when `existingBody` has an unbalanced pair.
  Returns `newBody` unchanged (no markers injected) when `existingBody` has no plan.

- [ ] **Step 1: Write the failing tests**

Add `replaceBodyPreservingPlan` to the destructured `require('./issue-body')` at the top of
`tools/github/lib/issue-body.test.js`, then append:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm run tools:test` Expected: FAIL — `replaceBodyPreservingPlan is not a function`.

- [ ] **Step 3: Implement the function**

In `tools/github/lib/issue-body.js`, add after `spliceImplementationPlan` and add
`replaceBodyPreservingPlan` to `module.exports`:

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm run tools:test` Expected: PASS — 16 tests, 0 fail.

- [ ] **Step 5: Format and commit**

```bash
pnpm run nx:workspace-format
git add tools/github/lib/issue-body.js tools/github/lib/issue-body.test.js
git commit -m "#35 feat(tools): add replaceBodyPreservingPlan, keeping the engineer plan byte-for-byte"
```

---

### Task 3: Shared `ghEditBody()` in `gh-client.js`

One temp-file body write, used by both scripts. Pure refactor; verified end-to-end by writing this
plan's checklist to the real ticket.

**Files:**

- Modify: `tools/github/lib/gh-client.js` (add `os` require, add `ghEditBody`, add to exports)
- Modify: `tools/github/update-ticket-status.js:86-103` (use the helper; drop `os`/`path` requires
  that become unused)

**Interfaces:**

- Consumes: `ghExec` (already in `gh-client.js`).
- Produces:
  `ghEditBody(owner: string, repo: string, issueNumber: string|number, body: string) => void`.
  Writes the body via a temp file and `gh issue edit --body-file`; dies through `ghExec` on failure.

- [ ] **Step 1: Add the helper**

In `tools/github/lib/gh-client.js`, add `const os = require('os');` beside the existing `fs`/`path`
requires, then add after `ghExec`:

```js
/**
 * Replace an issue body. The new body reaches `gh` via a temp file, never an inline `--body`:
 * a full ticket body blows the Windows command-line length limit, and a `\n` inside an argument
 * reaches GitHub literally (see unescapeInlineText).
 */
function ghEditBody(owner, repo, issueNumber, body) {
  const tmp = path.join(os.tmpdir(), `cribstop-ticket-${issueNumber}-body.md`);
  fs.writeFileSync(tmp, body, 'utf-8');
  try {
    ghExec([
      'issue',
      'edit',
      String(issueNumber),
      '--repo',
      `${owner}/${repo}`,
      '--body-file',
      tmp,
    ]);
  } finally {
    fs.unlinkSync(tmp);
  }
}
```

Add `ghEditBody` to `module.exports`, next to `ghExec`.

- [ ] **Step 2: Use it from `update-ticket-status.js`**

Replace the temp-file block in the `--plan-file` branch (currently lines 94–101) with:

```js
ghEditBody(owner, repo, args.issue, updated);
```

Add `ghEditBody` to the destructured `require('./lib/gh-client')` list, and delete the now-unused
`os` and `path` requires at the top of the file (`fs` is still used for reading the plan file).

- [ ] **Step 3: Verify the module still loads and nothing is unused**

Run: `pnpm run tools:test` Expected: PASS — 16 tests.

Run: `pnpm run gh:ticket:view -- --issue 35` Expected: the ticket renders — proves `gh-client.js`
still loads cleanly for every consumer.

- [ ] **Step 4: Verify the write path end-to-end against the real ticket**

The checklist was already written to #35 before Task 1 (the workflow requires it), so this run
exercises `ghEditBody` plus `spliceImplementationPlan`'s **replace-in-place** branch against a real
body. Tick off the items landed so far in the checklist file first, so this is a genuine update:

```bash
pnpm run gh:ticket:update-status -- --issue 35 --plan-file ./docs/superpowers/plans/2026-08-07-po-ticket-body-editing-checklist.md
pnpm run gh:ticket:view -- --issue 35
```

Expected: `✓ Issue #35: Implementation Plan section updated`, the checklist visible in the body, the
Problem / Acceptance Criteria / Technical Notes sections unchanged, and exactly one marker pair.

- [ ] **Step 5: Format and commit**

```bash
pnpm run nx:workspace-format
git add tools/github/lib/gh-client.js tools/github/update-ticket-status.js
git commit -m "#35 refactor(tools): share the temp-file body write as ghEditBody"
```

---

### Task 4: `--body-file` on `gh:ticket:update-fields`

**Files:**

- Modify: `tools/github/update-ticket-fields.js` (header usage comment, imports, `main()`)

**Interfaces:**

- Consumes: `replaceBodyPreservingPlan`, `findPlanBlock` from Task 2; `ghEditBody`, `ghJson` from
  Task 3.
- Produces: `pnpm run gh:ticket:update-fields -- --issue <n> --body-file <path>`.

- [ ] **Step 1: Import what the flag needs**

In `tools/github/update-ticket-fields.js`, add `const fs = require('fs');` at the top, add
`ghEditBody` and `ghJson` to the `gh-client` destructure, and add:

```js
const { replaceBodyPreservingPlan, findPlanBlock } = require('./lib/issue-body');
```

- [ ] **Step 2: Move `issueRef` above the write section and extend the no-op guard**

`issueRef` is currently declared at line 88, below the field-edit block; the body validation needs
it first. Move this line to just after the `if (!args.issue) die(...)` check:

```js
const issueRef = ['--repo', `${owner}/${repo}`];
```

Then extend the guard:

```js
if (provided.length === 0 && !args.milestone && !args['remove-milestone'] && !args['body-file']) {
  die(
    'Provide at least one of --status, --priority, --size, --milestone, --remove-milestone, ' +
      '--body-file',
  );
}
```

- [ ] **Step 3: Validate and compute the new body BEFORE any write**

Insert immediately after that guard — ahead of the field-edit block, so a rejected body leaves the
fields untouched too:

```js
// Resolve the whole body up front: a refused --body-file must leave the ticket completely
// untouched, fields included, so every validation happens before the first gh mutation.
let bodyToWrite = null;
let existingHadPlan = false;
if (args['body-file']) {
  const file = args['body-file'];
  if (!fs.existsSync(file)) die(`--body-file not found: ${file}`);
  const incoming = fs.readFileSync(file, 'utf-8');
  if (!incoming.trim()) die(`--body-file is empty: ${file}`);

  const issue = ghJson(['issue', 'view', args.issue, ...issueRef, '--json', 'body']);
  const existing = issue.body || '';
  existingHadPlan = findPlanBlock(existing) !== null;
  try {
    bodyToWrite = replaceBodyPreservingPlan(existing, incoming);
  } catch (error) {
    die(error.message);
  }
}
```

- [ ] **Step 4: Write the body after the field edits, before the milestone edit**

```js
if (bodyToWrite !== null) {
  ghEditBody(owner, repo, args.issue, bodyToWrite);
  ok(
    `Issue #${args.issue}: body replaced` +
      (existingHadPlan ? ' (Implementation Plan preserved)' : ''),
  );
}
```

- [ ] **Step 5: Update the header usage comment**

Add to the `Usage:` block at the top of the file:

```js
 *   pnpm run gh:ticket:update-fields -- --issue 42 --body-file ./spec.md
```

- [ ] **Step 6: Verify the rejection paths — nothing may be written**

Run from the repo root. Export the scratchpad path first so both the shell and the `node -e` probe
in Step 7 can see it:

```bash
export SP="C:/Users/jmbilizi/AppData/Local/Temp/claude/C--Src-real-estate-platform/a89192b7-dc51-4aa0-82cb-b03cde6cf2fd/scratchpad"
```

```bash
# a) missing file
pnpm run gh:ticket:update-fields -- --issue 35 --body-file ./does-not-exist.md
# b) incoming body carrying a marker
printf '## Problem\n\nx\n<!-- implementation-plan:start -->\n' > "$SP/bad-body.md"
pnpm run gh:ticket:update-fields -- --issue 35 --body-file "$SP/bad-body.md"
# c) no actionable flag
pnpm run gh:ticket:update-fields -- --issue 35
```

Expected: (a) `✗ --body-file not found: ...`; (b)
`✗ The new body contains an Implementation Plan marker ... Nothing was written.`; (c) the extended
`Provide at least one of ...` message. Then `pnpm run gh:ticket:view -- --issue 35` shows the body
untouched.

- [ ] **Step 7: Verify the happy path with a no-op round-trip on the real ticket**

Rewriting #35's own body with its own product-owner content proves the flag end-to-end without
putting a single wrong character on the board. Capture the body, strip the plan block, write it
back, and diff:

```bash
pnpm run gh:ticket:view -- --issue 35 > "$SP/35-before.txt"
node -e "const{execSync}=require('child_process');const{findPlanBlock}=require('./tools/github/lib/issue-body');const b=JSON.parse(execSync('gh issue view 35 --repo jmbilizi/real-estate-platform --json body',{encoding:'utf-8'})).body;const k=findPlanBlock(b);require('fs').writeFileSync(process.env.SP+'/35-po-only.md',k?b.slice(0,k.start).trimEnd()+'\n':b)"
pnpm run gh:ticket:update-fields -- --issue 35 --body-file "$SP/35-po-only.md"
pnpm run gh:ticket:view -- --issue 35 > "$SP/35-after.txt"
diff "$SP/35-before.txt" "$SP/35-after.txt"
```

Expected: `✓ Issue #35: body replaced (Implementation Plan preserved)` and an **empty diff** — the
Problem/AC/Technical Notes are intact and the plan checklist from Task 3 survived unchanged. (The
`node -e` line is a one-off verification probe, not shipped code; it reads `gh` directly only
because it is a test harness, not a board operation.)

- [ ] **Step 8: Format and commit**

```bash
pnpm run nx:workspace-format
git add tools/github/update-ticket-fields.js
git commit -m "#35 feat(tools): add --body-file to gh:ticket:update-fields, preserving the plan section"
```

---

### Task 5: `--add-label` / `--remove-label` on `gh:ticket:update-fields`

**Files:**

- Modify: `tools/github/update-ticket-fields.js` (repeatable-flag parsing, guard message, label
  write, header usage comment)

**Interfaces:**

- Consumes: `issueRef` and the validation ordering from Task 4.
- Produces: repeatable `--add-label <name>` / `--remove-label <name>`, applied in a single
  `gh issue edit` call.

- [ ] **Step 1: Teach `parseArgs` about repeatable flags**

In `tools/github/update-ticket-fields.js`, beside the existing `FLAGS` set:

```js
const REPEATABLE = new Set(['add-label', 'remove-label']);
```

and in `parseArgs`, between the `FLAGS` branch and the final `else`:

```js
    } else if (REPEATABLE.has(key)) {
      (args[key] ||= []).push(argv[i + 1]);
      i++;
```

- [ ] **Step 2: Collect and validate the labels, extend the guard**

In `main()`, after `const provided = ...`:

```js
const labelsToAdd = args['add-label'] || [];
const labelsToRemove = args['remove-label'] || [];
if (labelsToAdd.some((label) => !label) || labelsToRemove.some((label) => !label)) {
  die('--add-label / --remove-label each require a label name');
}
```

and extend the no-op guard from Task 4 to its final form:

```js
if (
  provided.length === 0 &&
  !args.milestone &&
  !args['remove-milestone'] &&
  !args['body-file'] &&
  labelsToAdd.length === 0 &&
  labelsToRemove.length === 0
) {
  die(
    'Provide at least one of --status, --priority, --size, --milestone, --remove-milestone, ' +
      '--body-file, --add-label, --remove-label',
  );
}
```

- [ ] **Step 3: Apply the label change in one `gh issue edit` call**

After the body write from Task 4, before the milestone block:

```js
// One call for the whole label change — gh rejects unknown labels, which is the validation we
// want (loud failure, nothing silently dropped).
if (labelsToAdd.length > 0 || labelsToRemove.length > 0) {
  ghExec([
    'issue',
    'edit',
    args.issue,
    ...issueRef,
    ...labelsToAdd.flatMap((label) => ['--add-label', label]),
    ...labelsToRemove.flatMap((label) => ['--remove-label', label]),
  ]);
  if (labelsToAdd.length > 0) ok(`Issue #${args.issue}: +${labelsToAdd.join(', +')}`);
  if (labelsToRemove.length > 0) ok(`Issue #${args.issue}: -${labelsToRemove.join(', -')}`);
}
```

- [ ] **Step 4: Update the header usage comment**

```js
 *   pnpm run gh:ticket:update-fields -- --issue 42 --add-label blocked --remove-label type:chore
```

- [ ] **Step 5: Verify — unknown label fails loudly**

Run: `pnpm run gh:ticket:update-fields -- --issue 35 --add-label not-a-real-label` Expected:
non-zero exit with gh's own rejection surfaced through `✗ gh issue edit ... failed:`.

Run: `pnpm run gh:ticket:update-fields -- --issue 35 --add-label` Expected:
`✗ --add-label / --remove-label each require a label name`.

- [ ] **Step 6: Verify — a real add/remove round-trip nets to zero**

`blocked` is a real repo label and the honest thing to test with; the two calls leave the board
exactly as it started.

```bash
pnpm run gh:ticket:update-fields -- --issue 35 --add-label blocked
pnpm run gh:ticket:view -- --issue 35 | grep Labels
pnpm run gh:ticket:update-fields -- --issue 35 --remove-label blocked
pnpm run gh:ticket:view -- --issue 35 | grep Labels
```

Expected: `blocked` present after the first pair of commands, and the label line back to
`type:chore, scope:shared` after the second. Confirm the final state before moving on.

- [ ] **Step 7: Format and commit**

```bash
pnpm run nx:workspace-format
git add tools/github/update-ticket-fields.js
git commit -m "#35 feat(tools): add repeatable --add-label/--remove-label to gh:ticket:update-fields"
```

---

### Task 6: Document the new flags where the two agents actually read

**Files:**

- Modify: `.github/copilot-instructions.md` (the Product Backlog command block, ~line 1332)
- Modify: `.claude/agents/cribstop-product-owner.md` (the "leave the plan section alone" bullet,
  ~line 126)

**Interfaces:** none (docs only).

- [ ] **Step 1: Extend the command block**

In `.github/copilot-instructions.md`, replace the product-owner grooming line inside the ```bash
block with:

```bash
# Product owner: reprioritize/groom (Status/Priority/Size — full field access):
pnpm run gh:ticket:update-fields -- --issue 42 --priority P0

# Product owner: correct a ticket's spec after creation. Replaces Problem / Acceptance Criteria /
# Technical Notes from the file and carries the engineer's Implementation Plan block over
# byte-for-byte; refuses (writing nothing) if the file itself contains a plan marker:
pnpm run gh:ticket:update-fields -- --issue 42 --body-file ./spec.md

# Product owner: labels on an existing ticket (both flags repeatable; unknown labels fail loudly):
pnpm run gh:ticket:update-fields -- --issue 42 --add-label blocked --remove-label type:chore
```

- [ ] **Step 2: Record it in the least-privilege paragraph**

Extend the paragraph below that block (`update-ticket-fields.js` vs `update-ticket-status.js` is a
deliberate least-privilege split...) with:

```markdown
The split is symmetric on the body: `update-fields --body-file` rewrites the product owner's
sections and cannot touch the plan block (it is carried over byte-for-byte, and a body file
containing a plan marker is rejected outright), while `update-status --plan-file` rewrites only the
plan block and cannot touch the product owner's sections. Unit tests for both directions live in
`tools/github/lib/issue-body.test.js` — run them with `pnpm run tools:test`.
```

- [ ] **Step 3: Tell the product-owner agent the capability exists**

In `.claude/agents/cribstop-product-owner.md`, extend the existing bullet that ends "...leave the
engineer's marker-delimited `## Implementation Plan` section alone: that's their execution state,
not your spec." with:

```markdown
Correct a stale spec in place with
`pnpm run gh:ticket:update-fields -- --issue <n> --body-file   <path>` rather than posting an
amendment comment and leaving the wrong body above it — the plan section is preserved for you
automatically, and the command refuses if your file contains a plan marker. Same tool for labels
that need to change after creation: `--add-label` / `--remove-label` (both repeatable).
```

- [ ] **Step 4: Verify formatting**

Run: `pnpm run nx:workspace-format-check` Expected: PASS (run `pnpm run nx:workspace-format` first
if it complains).

- [ ] **Step 5: Commit**

```bash
git add .github/copilot-instructions.md .claude/agents/cribstop-product-owner.md
git commit -m "#35 docs(tools): document --body-file and label flags for the product-owner loop"
```

---

### Task 7: Make the new tests actually run in validation

**Scope note — this task goes one step beyond the ticket's AC and a reviewer may reject it
independently.** The AC requires a test; the Technical Notes observe that `tools/` is covered by no
Nx target, so nothing would ever execute it. Wiring `tools:test` into `pre-push` is ~12 lines and
costs ~0.3s. Ticket #38 (the `tools/` lint gap) remains the place for the Nx/CI-side fix; this does
not pre-empt it.

**Files:**

- Modify: `scripts/pre-push.js` (add a step + call it from `main()`)

**Interfaces:**

- Consumes: the `tools:test` script from Task 1.
- Produces: nothing importable.

- [ ] **Step 1: Add the step function**

In `scripts/pre-push.js`, after `checkInfrastructure()`:

```js
// Unit tests for tools/ — not an Nx project, so no nx target covers it (see #38).
function checkToolsScripts() {
  logStep('Validating tools/ Scripts');

  const result = run('pnpm run tools:test');
  if (!result.success) {
    logError('tools/ tests failed - run "pnpm run tools:test" to reproduce');
    return false;
  }
  logSuccess('tools/ tests passed');
  return true;
}
```

- [ ] **Step 2: Call it from `main()`**

Immediately after the `checkInfrastructure()` call and its `allPassed` line:

```js
const toolsResult = checkToolsScripts();
allPassed = allPassed && toolsResult;
```

- [ ] **Step 3: Verify it runs and can fail**

Run: `pnpm run tools:test` Expected: PASS — 16 tests.

Temporarily break one assertion in `tools/github/lib/issue-body.test.js`, run `pnpm run tools:test`,
confirm a **non-zero exit** (so `pre-push` would actually block), then revert the break and re-run
to confirm PASS. Verify the revert with `git diff -- tools/github/lib/issue-body.test.js` showing no
changes.

- [ ] **Step 4: Commit**

```bash
pnpm run nx:workspace-format
git add scripts/pre-push.js
git commit -m "#35 chore(tools): run tools:test in pre-push so the ticket-wrapper tests execute"
```

---

## Final Verification & Handoff

- [ ] **Step 1: Full validation**

Run: `pnpm run pre-push` Expected: all checks pass, including the new `Validating tools/ Scripts`
step.

- [ ] **Step 2: Confirm the board is exactly as it started**

Run: `pnpm run gh:ticket:view -- --issue 35` Expected: Labels `type:chore, scope:shared` (the Task 5
round-trip reverted), Status `In progress`, the product-owner sections unchanged, and the
Implementation Plan checklist fully checked.

- [ ] **Step 3: Confirm no background processes survive**

Run: `ps -W | grep -E 'skaffold|kubectl|node'` Expected: nothing from this session. (Nothing here
starts a server, but the repo rule is unconditional.)

- [ ] **Step 4: Open the PR and move the board**

Use `superpowers:finishing-a-development-branch`, then the `close-ticket` skill to move #35 to In
Review. PR title `#35 chore(tools): product-owner ticket body & label editing`, body containing
`Closes #35`.
````
