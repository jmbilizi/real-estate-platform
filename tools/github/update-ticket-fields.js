#!/usr/bin/env node

/**
 * Updates Status/Priority/Size on an existing ticket. This is the cribstop-product-owner agent's tool
 * for backlog grooming/reprioritizing (bumping Priority/Size without necessarily touching
 * Status) — engineer flows should use the narrower update-ticket-status.js instead, which
 * can't touch Priority/Size, so an engineer session can't accidentally reprioritize the
 * backlog while just moving a ticket through the workflow.
 *
 * Usage:
 *   pnpm run gh:ticket:update-fields -- --issue 42 --priority P0 --size L
 *   pnpm run gh:ticket:update-fields -- --issue 42 --status Ready
 *   pnpm run gh:ticket:update-fields -- --issue 42 --milestone "Beta Launch"
 *   pnpm run gh:ticket:update-fields -- --issue 42 --remove-milestone
 *   pnpm run gh:ticket:update-fields -- --issue 42 --body-file ./spec.md
 *   pnpm run gh:ticket:update-fields -- --issue 42 --add-label blocked --remove-label type:chore
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
  die,
  ok,
} = require('./lib/gh-client');
const { replaceBodyPreservingPlan, findPlanBlock } = require('./lib/issue-body');

const FLAGS = new Set(['remove-milestone']);
const REPEATABLE = new Set(['add-label', 'remove-label']);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') continue; // pnpm forwards the literal '--' separator — never a flag
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    if (FLAGS.has(key)) {
      args[key] = true;
    } else if (REPEATABLE.has(key)) {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(
          value
            ? `--${key} requires a label name (got "${value}")`
            : `--${key} requires a label name`,
        );
      }
      (args[key] ||= []).push(value);
      i++;
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
}

if (require.main === module) main();

module.exports = { parseArgs };
