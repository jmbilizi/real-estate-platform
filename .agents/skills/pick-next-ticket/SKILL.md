---
name: pick-next-ticket
description:
  Selects the next ticket to work on from the shared GitHub Projects v2 board (Cribstop Platform
  Backlog), sorted by Status=Ready and Priority, and hands off into normal planning. Use when
  starting an engineering session with no specific task assigned yet — "what should I work on next",
  "pick up the next ticket", "grab something off the backlog".
---

# Pick Next Ticket

Full board/command reference: `AGENTS.md` → "Product Backlog (GitHub Issues & Projects)". Never call
`gh`/`git` directly for this — always the `pnpm run gh:ticket:*` wrappers.

## Steps

1. **Query ready work**, filtered to this session's scope if one is obvious (e.g. already working
   inside `apps/clients/cribstop` → add `--scope cribstop-web`):

   ```bash
   pnpm run gh:ticket:list -- --status Ready --format json
   ```

   Results are already sorted by `Priority` (board option order — first result is highest priority).
   If a `--scope` filter returns nothing, retry without it before concluding the backlog is empty.

2. **If nothing is Status=Ready**, say so — do not fall back to `Backlog` tickets silently. Ask the
   user whether to pick one anyway or wait for grooming.

3. **Present the top match** (title, priority, size, scope labels, milestone if any — read-only
   context explaining the priority, never a selection criterion — and URL) and confirm with the user
   before starting — a sorted list isn't always the right pick if the user has context the board
   doesn't capture (e.g. a teammate is already on it).

4. **Claim it** — moves Status to In Progress, assigns you, and leaves a claim comment in one call
   (this uses the narrower engineer-facing script; it can't touch Priority/Size):

   ```bash
   pnpm run gh:ticket:update-status -- --issue <number> --status "In Progress" --claim
   ```

5. **Hand off into normal planning** — pull the full ticket body for context
   (`pnpm run gh:ticket:view -- --issue <number>`), then invoke `superpowers:brainstorming` (or
   `superpowers:writing-plans` if the ticket's acceptance criteria are already concrete enough to
   skip straight to a plan). Before coding starts, the plan goes into the ticket itself as an
   ordered checklist — each item independently testable, roughly one commit — via
   `pnpm run gh:ticket:update-status -- --issue <number> --plan-file <path>` (writes only the
   marker-delimited `## Implementation Plan` section; keep its checkboxes current as items land so
   any later session can resume mid-ticket). Work happens on one branch `<number>-short-slug` cut
   from `dev`. This skill's job is selection and handoff, not planning or implementation.

6. When the resulting branch is ready to merge, use the `close-ticket` skill to move Status to In
   Review / Done — don't leave the board saying "In Progress" after the work has shipped.
