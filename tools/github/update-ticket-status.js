#!/usr/bin/env node

/**
 * Engineer-facing status transitions. Deliberately narrower than update-ticket-fields.js —
 * this script can only touch Status (+ assignee/comments), never Priority/Size, so an
 * engineer session moving a ticket through the workflow can't accidentally reprioritize the
 * backlog. That's the cribstop-product-owner agent's job, via update-ticket-fields.js.
 *
 * The one body edit it allows is the Implementation Plan: --plan-file replaces ONLY the
 * marker-delimited "## Implementation Plan" section of the issue body (appending it on first use),
 * so the engineer can maintain its checklist without being able to touch the product owner's
 * Problem / Acceptance Criteria / Technical Notes sections.
 *
 * Usage:
 *   pnpm run gh:ticket:update-status -- --issue 42 --status "In Progress" --claim
 *   pnpm run gh:ticket:update-status -- --issue 42 --status Done --comment "Shipped in PR #57"
 *   pnpm run gh:ticket:update-status -- --issue 42 --plan-file ./plan.md
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  ensureGhReady,
  requireConfig,
  loadSchema,
  findProjectItemId,
  resolveFieldOption,
  ghExec,
  ghJson,
  die,
  ok,
} = require('./lib/gh-client');

const PLAN_START = '<!-- implementation-plan:start -->';
const PLAN_END = '<!-- implementation-plan:end -->';

/**
 * Replace the marker-delimited Implementation Plan section in an issue body, or append one if the
 * markers aren't present yet. Everything outside the markers is returned byte-for-byte.
 */
function spliceImplementationPlan(body, plan) {
  const section = `${PLAN_START}\n\n## Implementation Plan\n\n${plan}\n\n${PLAN_END}`;
  const start = body.indexOf(PLAN_START);
  const end = body.indexOf(PLAN_END);
  if (start !== -1 && end !== -1 && end > start) {
    return body.slice(0, start) + section + body.slice(end + PLAN_END.length);
  }
  return `${body.trimEnd()}\n\n${section}\n`;
}

const FLAGS = new Set(['claim']);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') continue; // pnpm forwards the literal '--' separator — never a flag
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    if (FLAGS.has(key)) {
      args[key] = true;
    } else {
      args[key] = argv[i + 1];
      i++;
    }
  }
  return args;
}

function main() {
  ensureGhReady();
  const { owner, repo } = requireConfig();
  const schema = loadSchema();
  const args = parseArgs(process.argv.slice(2));

  if (!args.issue) die('--issue <number> is required');
  if (!args.status && !args.claim && !args.comment && !args['plan-file']) {
    die('Provide at least one of --status, --claim, --comment, --plan-file');
  }

  const issueRef = ['--repo', `${owner}/${repo}`];

  if (args['plan-file']) {
    if (!fs.existsSync(args['plan-file'])) die(`--plan-file not found: ${args['plan-file']}`);
    const plan = fs.readFileSync(args['plan-file'], 'utf-8').trim();
    if (!plan) die(`--plan-file is empty: ${args['plan-file']}`);

    const issue = ghJson(['issue', 'view', args.issue, ...issueRef, '--json', 'body']);
    const updated = spliceImplementationPlan(issue.body || '', plan);

    // gh needs the new body via file — inline args hit quoting/length limits on Windows.
    const tmp = path.join(os.tmpdir(), `cribstop-ticket-${args.issue}-body.md`);
    fs.writeFileSync(tmp, updated, 'utf-8');
    try {
      ghExec(['issue', 'edit', args.issue, ...issueRef, '--body-file', tmp]);
    } finally {
      fs.unlinkSync(tmp);
    }
    ok(`Issue #${args.issue}: Implementation Plan section updated`);
  }

  if (args.status) {
    const itemId = findProjectItemId(owner, repo, args.issue, schema.projectId);
    const { fieldId, optionId } = resolveFieldOption(schema, 'Status', args.status);
    ghExec([
      'project',
      'item-edit',
      '--id',
      itemId,
      '--project-id',
      schema.projectId,
      '--field-id',
      fieldId,
      '--single-select-option-id',
      optionId,
    ]);
    ok(`Issue #${args.issue}: Status = ${args.status}`);
  }

  if (args.claim) {
    ghExec(['issue', 'edit', args.issue, ...issueRef, '--add-assignee', '@me']);
    ok(`Issue #${args.issue}: assigned to self`);
  }

  const comment = args.comment || (args.claim ? 'Picked up via pick-next-ticket.' : null);
  if (comment) {
    ghExec(['issue', 'comment', args.issue, ...issueRef, '--body', comment]);
    ok(`Issue #${args.issue}: commented`);
  }
}

if (require.main === module) main();

module.exports = { spliceImplementationPlan };
