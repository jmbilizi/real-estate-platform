Branch `35-ticket-body-edit-flags` (from `dev`). Full step-by-step plan with code:
`docs/superpowers/plans/2026-08-07-po-ticket-body-editing.md`.

Design: the two body operations are mirror images — `--plan-file` replaces the plan and keeps the
surround; `--body-file` replaces the surround and keeps the plan. Both live in one new pure module,
`tools/github/lib/issue-body.js`, so the marker constants can never drift apart and start destroying
each other's section.

Scope addition, agreed after writing this plan corrupted this ticket (see the incident comment):
marker **lookup** must ignore code spans and fenced blocks. A bare marker is structure; a backticked
one is prose. Without it `--plan-file` keeps destroying any ticket that documents the markers — this
one included — and the AC's "reject an incoming body containing either marker" would refuse this
ticket's own Acceptance Criteria.

- [x] **1. Shared `issue-body` module + code-span-aware lookup + a test runner for `tools/`** — move
      `PLAN_START`/`PLAN_END` and `spliceImplementationPlan` out of `update-ticket-status.js` into
      `tools/github/lib/issue-body.js`, adding `maskCode` (blanks code spans/fences preserving
      length, so indices still map to the original), `findPlanBlock` and `containsBarePlanMarker`.
      Reuses the `MARKDOWN_CODE_SEGMENT` precedent from `lib/gh-client.js`. Add
      `tools/github/lib/issue-body.test.js` and a `tools:test` script (`node --test tools` —
      `tools/` is not an Nx project, so nothing covers it today). Verify: `pnpm run tools:test`,
      then re-write this checklist to this ticket and diff — the AC bullet quoting the markers must
      not appear in the diff.
- [x] **2. `replaceBodyPreservingPlan(existingBody, newBody)`** — the inverse operation, and the
      only wholly new logic. Carries the marker-delimited block over byte-for-byte, appended after
      the new content; returns `newBody` as-is (no markers injected) when the issue has no plan;
      throws when the incoming body carries a **bare** marker, and when the existing markers are
      unbalanced. A backticked mention is accepted. Tested with a fixture containing
      checked/unchecked items, nested items and a fenced code block. Verify: `pnpm run tools:test`.
- [x] **3. Share the temp-file body write as `ghEditBody()`** in `lib/gh-client.js`, and switch
      `update-ticket-status.js --plan-file` onto it. Verify end-to-end against this ticket.
- [x] **4. `--body-file` on `gh:ticket:update-fields`** — all validation runs before the first `gh`
      mutation, so a refused body leaves the ticket untouched, fields included. Verify: missing
      file, bare-marker-in-incoming-body and no-flag cases all fail with nothing written; then a
      no-op round-trip of this ticket's own body diffs empty.
- [x] **5. Repeatable `--add-label` / `--remove-label`** — applied in one `gh issue edit` call;
      unknown labels fail loudly via `gh` itself. Guard message extended to list every new flag.
      Verify: unknown label fails; a real add/remove round-trip nets the board back to
      `type:chore, scope:shared`.
- [x] **6. Docs** — `.github/copilot-instructions.md` (command block + the symmetry of the
      least-privilege split), and `.claude/agents/cribstop-product-owner.md` so the product owner
      actually knows the flag exists instead of posting another amendment comment.
- [x] **7. Run `tools:test` in `pre-push`** — beyond the letter of the AC, and separable: without it
      nothing ever executes the test this ticket mandates. #38 stays the place for the Nx/CI-side
      lint fix.
