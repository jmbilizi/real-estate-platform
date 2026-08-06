#!/usr/bin/env node

/**
 * Creates a ticket end-to-end: issue + project item + Status/Priority/Size fields + labels,
 * in one atomic command. If any step after issue-creation fails, this fails loudly rather than
 * leaving a ticket that exists but isn't tracked on the board correctly.
 *
 * "Ready to work" is expressed as `--status Ready` (Status progresses Backlog → Ready →
 * In Progress → In Review → Done) rather than a separate readiness field — a ticket can't be
 * simultaneously Backlog and Ready-for-dev this way.
 *
 * Usage:
 *   pnpm run gh:ticket:create -- \
 *     --title "Add saved-search alerts" \
 *     --body-file ./ticket-body.md \
 *     --priority P1 \
 *     --size M \
 *     --status Ready \
 *     --scope cribstop --scope api-gateway \
 *     --label type:feature \
 *     --milestone "Beta Launch"
 *
 * Always use `--body-file` for the body. `--body` exists for one-liners; multi-line markdown passed
 * that way arrives with literal `\n` characters (see resolveBody below).
 */

const fs = require('fs');
const {
  ensureGhReady,
  requireConfig,
  loadSchema,
  ghExec,
  ghJson,
  resolveFieldOption,
  unescapeInlineText,
  die,
  ok,
  info,
} = require('./lib/gh-client');

function parseArgs(argv) {
  const args = { label: [], scope: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') continue; // pnpm forwards the literal '--' separator — never a flag
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (key === 'label' || key === 'scope') {
      args[key].push(value);
    } else {
      args[key] = value;
    }
    i++;
  }
  return args;
}

/** Reads the body from `--body-file` (preferred) or `--body`. See `unescapeInlineText`. */
function resolveBody(args) {
  if (args['body-file']) return fs.readFileSync(args['body-file'], 'utf-8');
  const raw = args.body || '';
  const unescaped = unescapeInlineText(raw);
  if (unescaped !== raw) {
    info('Body contained literal \\n / \\t escapes — unescaping. Prefer --body-file for markdown.');
  }
  return unescaped;
}

function main() {
  ensureGhReady();
  const { owner, repo, projectNumber } = requireConfig();
  const schema = loadSchema();
  const args = parseArgs(process.argv.slice(2));

  if (!args.title) {
    die('--title is required');
  }

  const body = resolveBody(args);

  const labels = [...args.label, ...args.scope.map((s) => `scope:${s}`)];

  info(`Creating issue "${args.title}"...`);
  const issueArgs = [
    'issue',
    'create',
    '--repo',
    `${owner}/${repo}`,
    '--title',
    args.title,
    '--body',
    body,
  ];
  for (const label of labels) {
    issueArgs.push('--label', label);
  }
  if (args.milestone) {
    issueArgs.push('--milestone', args.milestone);
  }
  const issueUrl = ghExec(issueArgs).trim();
  const issueNumber = issueUrl.split('/').pop();
  ok(`Created issue #${issueNumber}: ${issueUrl}`);

  info('Adding to project board...');
  const item = ghJson([
    'project',
    'item-add',
    String(projectNumber),
    '--owner',
    owner,
    '--url',
    issueUrl,
    '--format',
    'json',
  ]);

  const fieldsToSet = {
    Status: args.status || 'Backlog',
    Priority: args.priority,
    Size: args.size,
  };

  for (const [fieldName, optionName] of Object.entries(fieldsToSet)) {
    if (!optionName) continue;
    const { fieldId, optionId } = resolveFieldOption(schema, fieldName, optionName);
    ghExec([
      'project',
      'item-edit',
      '--id',
      item.id,
      '--project-id',
      schema.projectId,
      '--field-id',
      fieldId,
      '--single-select-option-id',
      optionId,
    ]);
    ok(`Set ${fieldName} = ${optionName}`);
  }

  ok(`Ticket ready: ${issueUrl}`);
}

main();
