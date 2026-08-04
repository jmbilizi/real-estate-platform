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
 */

const {
  ensureGhReady,
  requireConfig,
  loadSchema,
  findProjectItemId,
  resolveFieldOption,
  ghExec,
  die,
  ok,
} = require('./lib/gh-client');

const FLAGS = new Set(['remove-milestone']);

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

  const fieldsToSet = {
    Status: args.status,
    Priority: args.priority,
    Size: args.size,
  };
  const provided = Object.entries(fieldsToSet).filter(([, value]) => value);
  if (provided.length === 0 && !args.milestone && !args['remove-milestone']) {
    die('Provide at least one of --status, --priority, --size, --milestone, --remove-milestone');
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

  // Milestone lives on the issue itself (not a project field); the board's Milestone
  // field reflects it automatically.
  const issueRef = ['--repo', `${owner}/${repo}`];
  if (args.milestone) {
    ghExec(['issue', 'edit', args.issue, ...issueRef, '--milestone', args.milestone]);
    ok(`Issue #${args.issue}: Milestone = ${args.milestone}`);
  } else if (args['remove-milestone']) {
    ghExec(['issue', 'edit', args.issue, ...issueRef, '--remove-milestone']);
    ok(`Issue #${args.issue}: Milestone removed`);
  }
}

main();
