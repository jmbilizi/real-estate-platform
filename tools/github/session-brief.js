#!/usr/bin/env node

/**
 * SessionStart hook: prints a compact backlog brief so any session (human or agent) starts
 * with the board state — or with the exact setup step that's missing. Registered in
 * .claude/settings.json; run manually via `pnpm run gh:session-brief`.
 *
 * Contract: ALWAYS exits 0 and never blocks a session. Board data is fetched through
 * list-tickets.js as a child process (never by requiring lib/gh-client.js — its die() calls
 * process.exit(1), which would kill the hook) with a hard timeout, failing quiet to a
 * one-liner. Output is injected into session context, so it stays small (~15 lines).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SCHEMA_PATH = path.join(__dirname, 'project-schema.json');
const LIST_SCRIPT = path.join(__dirname, 'list-tickets.js');
const FETCH_TIMEOUT_MS = 8000;
const READY_LIMIT = 5;

function run(cmd, args, timeout) {
  const result = spawnSync(cmd, args, { encoding: 'utf-8', shell: false, timeout });
  return { success: result.status === 0 && !result.error, stdout: (result.stdout || '').trim() };
}

function currentBranch() {
  const result = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], 3000);
  return result.success ? result.stdout : null;
}

function ticketLine(item) {
  const priority = item.fields.Priority || '—';
  const milestone = item.milestone ? ` ⟶ ${item.milestone}` : '';
  return `- #${item.number} [${priority}] ${item.title}${milestone}`;
}

/**
 * One-line scope progress for the epic (milestone) of the work most likely to be touched next —
 * the first In Progress or Ready item that has one. Milestones here are epics (scope
 * containers), so progress is delivered/total stories; a due date is shown only as context.
 */
function milestoneProgressLine(items, nextUp) {
  const anchor = nextUp.find((i) => i.milestone);
  if (!anchor) return null;
  const inMilestone = items.filter((i) => i.milestone === anchor.milestone);
  const done = inMilestone.filter(
    (i) => i.state === 'CLOSED' || (i.fields.Status || '').toLowerCase() === 'done',
  ).length;
  const due = anchor.milestoneDue ? `, target ${anchor.milestoneDue.slice(0, 10)}` : '';
  return `Epic "${anchor.milestone}": ${done}/${inMilestone.length} stories delivered${due}.`;
}

function main() {
  const lines = ['## Cribstop Platform Backlog — session brief'];

  if (!run('gh', ['--version'], 3000).success) {
    lines.push('Board unavailable: `gh` CLI is not installed. Run: pnpm run gh:setup');
    return lines;
  }
  if (!run('gh', ['auth', 'status'], 5000).success) {
    lines.push('Board unavailable: `gh` is not authenticated. Run: gh auth login');
    lines.push('(Projects access also needs the project scope: gh auth refresh -s project)');
    return lines;
  }

  let schema = null;
  try {
    schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf-8'));
  } catch {
    /* treated as unsynced below */
  }
  if (!schema || !schema.projectId) {
    lines.push('Board schema not synced yet. Run: pnpm run gh:project:sync-schema');
    lines.push('(If it fails on scopes: gh auth refresh -s project)');
    return lines;
  }

  const fetched = run(process.execPath, [LIST_SCRIPT, '--format', 'json'], FETCH_TIMEOUT_MS);
  let items;
  try {
    items = JSON.parse(fetched.stdout);
  } catch {
    items = null;
  }
  if (!fetched.success || !Array.isArray(items)) {
    lines.push(
      'Board unreachable right now (network/auth?). Check manually: pnpm run gh:ticket:list',
    );
    return lines;
  }

  const status = (i) => (i.fields.Status || '').toLowerCase();
  const open = items.filter((i) => i.state === 'OPEN');
  const inProgress = open.filter((i) => status(i) === 'in progress');
  const ready = open.filter((i) => status(i) === 'ready');

  if (inProgress.length > 0) {
    lines.push('In Progress (resume candidates — branch `<n>-short-slug`, reconcile the');
    lines.push("ticket's `## Implementation Plan` checkboxes against the branch commits):");
    inProgress.forEach((i) => lines.push(ticketLine(i)));
  }

  const branch = currentBranch();
  const branchTicket = branch && branch.match(/^(\d+)-/);
  if (branchTicket) {
    lines.push(
      `Current branch \`${branch}\` looks mid-ticket: pnpm run gh:ticket:view -- --issue ${branchTicket[1]}`,
    );
  }

  if (ready.length > 0) {
    lines.push(`Ready (top ${Math.min(ready.length, READY_LIMIT)} by priority):`);
    ready.slice(0, READY_LIMIT).forEach((i) => lines.push(ticketLine(i)));
    if (ready.length > READY_LIMIT) lines.push(`…and ${ready.length - READY_LIMIT} more Ready.`);
  } else {
    lines.push(
      'No Ready tickets — dispatch the cribstop-product-owner agent to groom the backlog.',
    );
  }

  const progress = milestoneProgressLine(items, [...inProgress, ...ready]);
  if (progress) lines.push(progress);

  lines.push(
    'Start work with the `pick-next-ticket` skill (or dispatch the principal-engineer agent).',
    'Board: https://github.com/users/jmbilizi/projects/7 — reference: AGENTS.md → "Product Backlog".',
  );
  return lines;
}

try {
  console.log(main().join('\n'));
} catch {
  // A broken brief must never break a session start.
}
process.exit(0);
