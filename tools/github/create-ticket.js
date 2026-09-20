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
  cliArgv,
  requireConfig,
  loadSchema,
  ghExec,
  run,
  findProjectItemId,
  resolveFieldOption,
  unescapeInlineText,
  die,
  ok,
  warn,
  info,
} = require('./lib/gh-client');
const { PLAN_START, PLAN_END, containsBarePlanMarker } = require('./lib/issue-body');

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

/**
 * Put the issue on the board and return its item id.
 *
 * A project automation can add the issue between `gh issue create` and this call. `gh project
 * item-add` then answers "Content already exists in this project" on stderr and exits non-zero,
 * although the state this script wants already holds. Aborting there is what left #118 on the board
 * with Status, Priority and Size unset, which hides it from every `gh:ticket:list` filter. So any
 * item-add failure falls back to resolving the item that is already there, and only a genuinely
 * absent item is fatal.
 */
function addToProject({ owner, repo, projectNumber, projectId, issueUrl, issueNumber }) {
  const result = run('gh', [
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

  if (result.success) {
    try {
      const item = JSON.parse(result.stdout);
      if (item.id) return item.id;
    } catch {
      // gh exited 0 — the item-add itself worked — but its stdout did not parse as expected. This
      // is not the failure the lookup below exists for, so it gets its own message: "could not be
      // added" would be false when gh just told us it succeeded.
      info('gh reported success but its output did not include an item id. Resolving it directly.');
    }
    const item = findProjectItemId(owner, repo, issueNumber, projectId, { optional: true });
    if (item) return item;
    die(
      'gh reported the issue was added to the board, but it cannot be found there. Check ' +
        `${issueUrl} by hand, then set its fields with: pnpm run gh:ticket:update-fields -- ` +
        `--issue ${issueNumber} --status <status> --priority <P0|P1|P2>`,
    );
  }

  const reason = result.stderr || result.stdout;
  const recovery =
    `Issue #${issueNumber} was created (${issueUrl}) but could not be added to the board:\n` +
    `  ${reason}\n` +
    '  Add it by hand, then set its fields with: pnpm run gh:ticket:update-fields -- --issue ' +
    `${issueNumber} --status <status> --priority <P0|P1|P2>`;

  // A failure that is not the duplicate is usually a missing `project` scope, and the fallback
  // lookup needs that same scope — it would die inside gh and take these instructions with it. So
  // print them first, then still try the lookup: the duplicate wording is gh's, not a contract.
  if (!/already exists/i.test(reason)) warn(recovery);

  const existing = findProjectItemId(owner, repo, issueNumber, projectId, { optional: true });
  if (existing) {
    info('Issue was already on the board — using the existing item.');
    return existing;
  }

  die(recovery);
}

function main() {
  ensureGhReady();
  const { owner, repo, projectNumber } = requireConfig();
  const schema = loadSchema();
  const args = parseArgs(cliArgv());

  if (!args.title) {
    die('--title is required');
  }

  const body = resolveBody(args);

  // Creation is a product-owner flow, so the same rule as update-ticket-fields --body-file applies:
  // the plan block is the engineer's, written only by gh:ticket:update-status --plan-file. Letting a
  // bare marker in here is how a ticket gets born with an unbalanced pair that later splices across
  // the product owner's own sections. A marker quoted in backticks or a fence is prose and is fine.
  if (containsBarePlanMarker(body)) {
    die(
      'The body contains an Implementation Plan marker ' +
        `(${PLAN_START} / ${PLAN_END}). That section is the engineer's execution state, written ` +
        'by `gh:ticket:update-status -- --plan-file` — remove the markers and everything between ' +
        'them from your file. Nothing was created.',
    );
  }

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
  const itemId = addToProject({
    owner,
    repo,
    projectNumber,
    projectId: schema.projectId,
    issueUrl,
    issueNumber,
  });

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
      itemId,
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
