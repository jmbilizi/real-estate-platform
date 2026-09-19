#!/usr/bin/env node

/**
 * Updates Status/Priority/Size on an existing ticket. This is the cribstop-product-owner agent's tool
 * for backlog grooming/reprioritizing (bumping Priority/Size without necessarily touching
 * Status) — engineer flows should use the narrower update-ticket-status.js instead, which
 * can't touch Priority/Size, so an engineer session can't accidentally reprioritize the
 * backlog while just moving a ticket through the workflow.
 *
 * Disposal is a product decision, so `--decline` lives here and never on update-ticket-status.js.
 * The board runs three priority levels on the principle that low-value work is declined, not parked
 * at a priority that never ships, and that principle needs a wrapper that can actually close.
 *
 * Usage:
 *   pnpm run gh:ticket:update-fields -- --issue 42 --priority P0 --size L
 *   pnpm run gh:ticket:update-fields -- --issue 42 --status Ready
 *   pnpm run gh:ticket:update-fields -- --issue 42 --title "New title"
 *   pnpm run gh:ticket:update-fields -- --issue 42 --milestone "Beta Launch"
 *   pnpm run gh:ticket:update-fields -- --issue 42 --remove-milestone
 *   pnpm run gh:ticket:update-fields -- --issue 42 --body-file ./spec.md
 *   pnpm run gh:ticket:update-fields -- --issue 42 --add-label blocked --remove-label type:chore
 *   pnpm run gh:ticket:update-fields -- --issue 42 --decline --reason "Superseded by #61"
 *   pnpm run gh:ticket:update-fields -- --issue 42 --reopen --reason "Stakeholder reversed the call"
 */

const fs = require('fs');

const {
  ensureGhReady,
  requireConfig,
  loadSchema,
  findProjectItemId,
  resolveFieldOption,
  ghExec,
  ghEditBody,
  ghJson,
  unescapeInlineText,
  die,
  ok,
} = require('./lib/gh-client');
const { parseArgs: parseFlags } = require('./lib/args');
const { replaceBodyPreservingPlan, findPlanBlock } = require('./lib/issue-body');

const PARSE_OPTIONS = {
  flags: ['remove-milestone', 'decline', 'reopen'],
  repeatable: { 'add-label': 'a label name', 'remove-label': 'a label name' },
};

function parseArgs(argv) {
  return parseFlags(argv, PARSE_OPTIONS);
}

/**
 * A title is one line. `gh issue edit --title` accepts a newline and GitHub then renders the
 * remainder nowhere, so a pasted multi-line value silently truncates the title on the board.
 */
function resolveTitle(raw) {
  const title = String(raw).trim();
  if (!title) throw new Error('--title is empty');
  if (/[\r\n]/.test(title)) throw new Error('--title must be a single line');
  return title;
}

function main() {
  ensureGhReady();
  const { owner, repo } = requireConfig();
  const schema = loadSchema();
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    die(error.message);
  }

  if (!args.issue) die('--issue <number> is required');

  const issueRef = ['--repo', `${owner}/${repo}`];

  const fieldsToSet = {
    Status: args.status,
    Priority: args.priority,
    Size: args.size,
  };
  const provided = Object.entries(fieldsToSet).filter(([, value]) => value);

  // parseArgs already rejects a missing/flag-shaped value for --add-label/--remove-label before
  // this point, so every entry here is guaranteed to be a real label string.
  const labelsToAdd = args['add-label'] || [];
  const labelsToRemove = args['remove-label'] || [];

  // A declined ticket must always record why, so the reason is mandatory and is posted as a
  // comment before the state change. Same for a reopen: the board shows the state, the comment
  // shows the decision behind it.
  if (args.decline && args.reopen) die('--decline and --reopen are mutually exclusive');
  const stateChange = args.decline ? 'decline' : args.reopen ? 'reopen' : null;
  if (!stateChange && args.reason) die('--reason only applies to --decline or --reopen');
  if (stateChange && !args.reason) die(`--${stateChange} requires --reason "<why>"`);
  const reason = stateChange ? unescapeInlineText(args.reason).trim() : null;
  if (stateChange && !reason) die('--reason is empty');

  if (
    provided.length === 0 &&
    !args.title &&
    !args.milestone &&
    !args['remove-milestone'] &&
    !args['body-file'] &&
    !stateChange &&
    labelsToAdd.length === 0 &&
    labelsToRemove.length === 0
  ) {
    die(
      'Provide at least one of --status, --priority, --size, --title, --milestone, ' +
        '--remove-milestone, --body-file, --add-label, --remove-label, --decline, --reopen',
    );
  }

  let title = null;
  try {
    if (args.title !== undefined) title = resolveTitle(args.title);
  } catch (error) {
    die(error.message);
  }

  // Resolve the whole body up front: a refused --body-file must leave the ticket completely
  // untouched, fields included, so every validation happens before the first gh mutation.
  let bodyToWrite = null;
  let existingHadPlan = false;
  if (args['body-file']) {
    const file = args['body-file'];
    if (!fs.existsSync(file)) die(`--body-file not found: ${file}`);
    // existsSync is true for a directory too, and the read below would then throw a raw EISDIR.
    if (fs.statSync(file).isDirectory()) die(`--body-file is a directory, not a file: ${file}`);
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

  if (provided.length > 0) {
    const itemId = findProjectItemId(owner, repo, args.issue, schema.projectId);

    for (const [fieldName, optionName] of provided) {
      const { fieldId, optionId } = resolveFieldOption(schema, fieldName, optionName);
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
      ok(`Issue #${args.issue}: ${fieldName} = ${optionName}`);
    }
  }

  if (title !== null) {
    ghExec(['issue', 'edit', args.issue, ...issueRef, '--title', title]);
    ok(`Issue #${args.issue}: title = ${title}`);
  }

  if (bodyToWrite !== null) {
    ghEditBody(owner, repo, args.issue, bodyToWrite);
    ok(
      `Issue #${args.issue}: body replaced` +
        (existingHadPlan ? ' (Implementation Plan preserved)' : ''),
    );
  }

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

  // Milestone lives on the issue itself (not a project field); the board's Milestone
  // field reflects it automatically.
  if (args.milestone) {
    ghExec(['issue', 'edit', args.issue, ...issueRef, '--milestone', args.milestone]);
    ok(`Issue #${args.issue}: Milestone = ${args.milestone}`);
  } else if (args['remove-milestone']) {
    ghExec(['issue', 'edit', args.issue, ...issueRef, '--remove-milestone']);
    ok(`Issue #${args.issue}: Milestone removed`);
  }

  if (stateChange) {
    // Comment first. If the comment fails, the ticket stays open and the reason is not lost in a
    // closed ticket nobody reads.
    ghExec(['issue', 'comment', args.issue, ...issueRef, '--body', reason]);
    ok(`Issue #${args.issue}: reason commented`);

    if (stateChange === 'decline') {
      // "not planned" is the only close reason this wrapper writes. Completed work closes through
      // the PR's `Closes #<n>`, which is the engineer's path, not a product-owner decision.
      ghExec(['issue', 'close', args.issue, ...issueRef, '--reason', 'not planned']);
      ok(`Issue #${args.issue}: declined (closed as not planned)`);
    } else {
      ghExec(['issue', 'reopen', args.issue, ...issueRef]);
      ok(`Issue #${args.issue}: reopened`);
    }
  }
}

if (require.main === module) main();

module.exports = { parseArgs, resolveTitle };
