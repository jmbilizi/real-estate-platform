---
name: close-ticket
description: Moves a ticket's board Status to In Review (PR opened) or Done (PR merged). Use
  alongside superpowers:finishing-a-development-branch whenever the work being finished started from
  a ticket picked up via the pick-next-ticket skill — "open a PR for this ticket", "mark ticket
  done", "the PR for #42 just merged".
---

# Close Ticket

Companion to `pick-next-ticket` — that skill moves a ticket to In Progress; this one moves it the
rest of the way. Full command reference: `.github/copilot-instructions.md` → "Product Backlog
(GitHub Issues & Projects)".

## Steps

1. **When a PR opens** for a ticket, include `Closes #<number>` in the PR body so the merge
   auto-closes the issue (standard GitHub convention — don't also call `gh issue close` here, that
   would just race the merge). First make sure the ticket's `## Implementation Plan` checkboxes
   reflect reality — every item checked off or explicitly noted as dropped
   (`pnpm run gh:ticket:update-status -- --issue <number> --plan-file <path>`); a plan that says
   half-done on a ticket entering review is a lie in both directions. Then:

   ```bash
   pnpm run gh:ticket:update-status -- --issue <number> --status "In Review"
   ```

2. **When that PR merges**:

   ```bash
   pnpm run gh:ticket:update-status -- --issue <number> --status "Done" --comment "Shipped in PR #<pr-number>"
   ```

3. If the ticket number isn't already known from context, ask the user rather than guessing — do not
   move an unrelated ticket's status.

This skill only touches `Status` (+ a completion comment) — it uses the engineer-facing
`update-ticket-status.js`, which can't touch `Priority`/`Size`. The cribstop-product-owner agent
owns those, via `update-ticket-fields.js`.
