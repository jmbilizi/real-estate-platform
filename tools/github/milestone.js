#!/usr/bin/env node

/**
 * Milestone CRUD (cribstop-product-owner tool). A milestone is used as an EPIC: an
 * outcome-scoped body of work, not a point in time — the hierarchy is milestone (epic, product
 * owner) → issue (story/deliverable, the Kanban unit) → Implementation Plan item (task,
 * engineer). Milestones are an overlay on the Kanban: they group stories and report scope
 * progress; they never change the pull order, which stays Status=Ready sorted by Priority.
 * `close` refuses while stories are still open — an epic is done when its scope is delivered.
 * Due dates are optional context, not deadlines.
 *
 * The description is the durable release-direction record (first line `Release: MVP` or
 * `Release: post-MVP`), so `list` prints it back and `update` never overwrites it silently.
 *
 * The gh CLI has no native milestone command, so CRUD goes through the REST API; assignment to
 * tickets goes through `gh:ticket:create/update-fields -- --milestone "<title>"`.
 *
 * Usage:
 *   pnpm run gh:milestone -- list [--all] [--full]
 *   pnpm run gh:milestone -- create --title "Services MVP" [--due 2026-09-15]
 *                                   [--description "..." | --description-file ./epic.md]
 *   pnpm run gh:milestone -- update --title "Services MVP" [--new-title "..."] [--due 2026-09-15]
 *                                   [--description "..." | --description-file ./epic.md] [--append]
 *   pnpm run gh:milestone -- close --title "Services MVP"
 *   pnpm run gh:milestone -- delete --title "Services MVP"
 */

const fs = require('fs');
const {
  ensureGhReady,
  cliArgv,
  requireConfig,
  run,
  ghJson,
  unescapeInlineText,
  die,
  ok,
  warn,
  info,
  log,
} = require('./lib/gh-client');
const {
  releaseMarkerProblem,
  formatDescription,
  appendDescription,
  isEmpty,
} = require('./lib/milestone-description');

/** Flags that carry no value. Everything else consumes the next argv element. */
const BOOLEAN_FLAGS = new Set(['all', 'full', 'append']);

/**
 * cmd.exe caps a command line at 8191 characters, and `pnpm run` adds the script name and the
 * forwarded `--` before Node ever sees it. An inline description near that cap fails with
 * "The command line is too long." from the shell, which names neither the flag nor the fix. Refuse
 * well below the cap and name `--description-file`, which keeps the text off the command line.
 */
const INLINE_DESCRIPTION_MAX = 6000;

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') continue; // pnpm forwards the literal '--' separator — never a flag
    if (!arg.startsWith('--')) {
      args._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (BOOLEAN_FLAGS.has(key)) {
      args[key] = true;
    } else {
      args[key] = argv[i + 1];
      i++;
    }
  }
  return args;
}

/**
 * Send a write to the REST API with the payload as JSON on stdin.
 *
 * `-f field=value` puts the whole description on the command line, which caps it at what the shell
 * accepts and mangles nothing predictably. `--input -` carries any length, and newlines and
 * backticks survive because JSON escapes them.
 */
function ghApiWrite(method, path, payload) {
  const result = run('gh', ['api', '--method', method, path, '--input', '-'], {
    input: JSON.stringify(payload),
  });
  if (!result.success) {
    die(`gh api --method ${method} ${path} failed:\n${result.stderr || result.stdout}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    return die(`gh api --method ${method} ${path} returned non-JSON output:\n${result.stdout}`);
  }
}

function listMilestones(base, state) {
  return ghJson(['api', `${base}?state=${state}&per_page=100`]);
}

function findByTitle(base, title) {
  const match = listMilestones(base, 'all').find(
    (m) => m.title.toLowerCase() === String(title).toLowerCase(),
  );
  if (!match) die(`No milestone titled "${title}". See: pnpm run gh:milestone -- list --all`);
  return match;
}

/**
 * The description to write, from `--description` or `--description-file`.
 * Returns `undefined` when the caller passed neither.
 */
function resolveDescription(args) {
  const hasInline = args.description !== undefined;
  const hasFile = args['description-file'] !== undefined;

  if (hasInline && hasFile) {
    die('Pass --description or --description-file, not both.');
  }
  if (hasFile) {
    const path = args['description-file'];
    if (!fs.existsSync(path)) die(`--description-file "${path}" does not exist.`);
    // Normalize to LF so a file written on Windows does not store CRLF in the release record.
    return fs.readFileSync(path, 'utf-8').replace(/\r\n/g, '\n');
  }
  if (!hasInline) return undefined;

  const raw = args.description;
  if (raw.length > INLINE_DESCRIPTION_MAX) {
    die(
      `--description is ${raw.length} characters, over the ${INLINE_DESCRIPTION_MAX}-character ` +
        'inline limit. Write it to a file and pass --description-file <path>, which keeps the text ' +
        'off the command line.',
    );
  }
  return unescapeInlineText(raw);
}

/** Print a milestone's description under its summary line, plus any release-marker problem. */
function printDescription(description, full) {
  const problem = releaseMarkerProblem(description);
  // Two spaces, not four: warn() prefixes "⚠ ", so this lines the text up with the description.
  if (problem) warn(`  ${problem}`);
  for (const line of formatDescription(description, { full })) log(line);
}

function commandList(base, args) {
  const milestones = listMilestones(base, args.all ? 'all' : 'open');
  if (milestones.length === 0) {
    log(args.all ? 'No milestones.' : 'No open milestones.');
    return;
  }
  for (const m of milestones) {
    const done = m.closed_issues;
    const total = m.closed_issues + m.open_issues;
    const due = m.due_on ? `due ${m.due_on.slice(0, 10)}` : 'no due date';
    log(`${m.title} [${m.state}] — ${due} — ${done}/${total} done — ${m.html_url}`);
    printDescription(m.description, args.full);
    log('');
  }
}

function commandCreate(base, args) {
  if (!args.title) die('--title is required');
  if (args.append) die('--append needs an existing milestone — use: update --append');

  const description = resolveDescription(args);
  const payload = { title: args.title };
  // T08:00:00Z (US-Pacific midnight) is GitHub's own storage convention for milestone due
  // dates — midnight UTC gets rendered as the *previous* day.
  if (args.due) payload.due_on = `${args.due}T08:00:00Z`;
  if (description !== undefined) payload.description = description;

  const created = ghApiWrite('POST', base, payload);
  ok(`Created milestone "${created.title}" (#${created.number}): ${created.html_url}`);
  const problem = releaseMarkerProblem(created.description);
  if (problem) warn(`  ${problem}`);
}

function commandUpdate(base, args) {
  if (!args.title) die('--title is required');
  // Resolve the flags before the lookup, so a malformed command fails without a round trip.
  let description = resolveDescription(args);
  const milestone = findByTitle(base, args.title);

  if (args.append) {
    if (description === undefined) {
      die('--append needs the text to add — pass --description or --description-file with it.');
    }
    description = appendDescription(milestone.description, description);
  }

  const payload = {};
  if (args['new-title']) payload.title = args['new-title'];
  if (args.due) payload.due_on = `${args.due}T08:00:00Z`;
  if (description !== undefined) payload.description = description;
  if (Object.keys(payload).length === 0) {
    die('Nothing to update — pass at least one of --new-title, --description, --description-file, --due');
  }

  // The description is the release-direction record, so a replacement always shows what it
  // replaced. Recovering the old text from the API audit log is not something anyone does.
  if (payload.description !== undefined && !args.append) {
    if (isEmpty(milestone.description)) {
      info('Previous description: (empty)');
    } else {
      info('Previous description (replaced by this update):');
      for (const line of formatDescription(milestone.description, { full: true })) log(line);
    }
  }

  const updated = ghApiWrite('PATCH', `${base}/${milestone.number}`, payload);
  ok(`Updated milestone "${updated.title}" (#${updated.number}): ${updated.html_url}`);
  const problem = releaseMarkerProblem(updated.description);
  if (problem) warn(`  ${problem}`);
}

function commandClose(base, args) {
  if (!args.title) die('--title is required');
  const milestone = findByTitle(base, args.title);
  if (milestone.open_issues > 0) {
    die(
      `Milestone "${milestone.title}" still has ${milestone.open_issues} open issue(s) — ` +
        'an epic closes when its scope is delivered. Ship them, or move them out ' +
        '(gh:ticket:update-fields -- --issue <n> --remove-milestone) if they were descoped.',
    );
  }
  ghApiWrite('PATCH', `${base}/${milestone.number}`, { state: 'closed' });
  ok(`Closed milestone "${milestone.title}"`);
}

function commandDelete(base, args) {
  if (!args.title) die('--title is required');
  const milestone = findByTitle(base, args.title);
  if (milestone.open_issues > 0) {
    die(
      `Milestone "${milestone.title}" still has ${milestone.open_issues} open issue(s) — ` +
        'reassign or close them first (deleting would silently detach them).',
    );
  }
  const result = run('gh', ['api', '--method', 'DELETE', `${base}/${milestone.number}`]);
  if (!result.success) die(`gh api --method DELETE failed:\n${result.stderr || result.stdout}`);
  ok(`Deleted milestone "${milestone.title}"`);
}

function main() {
  ensureGhReady();
  const { owner, repo } = requireConfig();
  const args = parseArgs(cliArgv());
  const base = `repos/${owner}/${repo}/milestones`;
  const command = args._[0] || 'list';

  const commands = {
    list: commandList,
    create: commandCreate,
    update: commandUpdate,
    close: commandClose,
    delete: commandDelete,
  };
  const handler = commands[command];
  if (!handler) die(`Unknown command "${command}". Use: ${Object.keys(commands).join(' | ')}`);
  handler(base, args);
}

main();
