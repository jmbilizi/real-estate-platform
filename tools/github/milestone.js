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
 *                                   [--description "..." | --description-file ./epic.md]
 *                                   [--append] [--clear-description]
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
const { parseArgs } = require('./lib/args');

/** `list | create | update | close | delete` arrives as a bare word; the rest are `--key value`. */
const PARSE_OPTIONS = {
  flags: ['all', 'full', 'append', 'clear-description'],
  positionals: true,
};

/**
 * cmd.exe caps a command line at 8191 characters, and `pnpm run` adds the script name and the
 * forwarded `--` before Node ever sees it. An inline description near that cap fails with
 * "The command line is too long." from the shell, which names neither the flag nor the fix.
 *
 * The check cannot stop that shell error — the shell wins before Node starts. It stops the command
 * from being written that way at all. It therefore applies on every platform, although only Windows
 * has the low cap: a milestone command that works on Linux has to work on Windows too, and an
 * author who is told to use `--description-file` once writes it that way everywhere after.
 */
const INLINE_DESCRIPTION_MAX = 6000;

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
  // The shared parser refuses an empty value, so erasing a description needs its own flag rather
  // than `--description ""`. Erasing is also the one destructive edit here, so it should be typed.
  if (args['clear-description']) {
    if (hasInline || hasFile) {
      die('Pass --clear-description on its own, without --description or --description-file.');
    }
    if (args.append) die('--clear-description and --append do the opposite of each other.');
    return '';
  }
  if (hasFile) {
    const path = args['description-file'];
    if (!fs.existsSync(path)) die(`--description-file "${path}" does not exist.`);
    if (fs.statSync(path).isDirectory()) die(`--description-file "${path}" is a directory.`);
    // Normalize to LF so a file written on Windows does not store CRLF in the release record.
    const text = fs.readFileSync(path, 'utf-8').replace(/\r\n/g, '\n');
    // A truncated file would otherwise erase the release-direction record with no way back.
    // Erasing a description on purpose stays available through --clear-description.
    if (!text.trim()) {
      die(
        `--description-file "${path}" is empty. To erase the description, pass --clear-description.`,
      );
    }
    return text;
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

/** Warn when a description has no release marker. Shared by list/create/update. */
function warnIfNoReleaseMarker(description) {
  const problem = releaseMarkerProblem(description);
  // Two spaces, not four: warn() prefixes "⚠ ", so this lines the text up with the description.
  if (problem) warn(`  ${problem}`);
}

/** Print a milestone's description under its summary line, plus any release-marker problem. */
function printDescription(description, full) {
  warnIfNoReleaseMarker(description);
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
  warnIfNoReleaseMarker(created.description);
}

function commandUpdate(base, args) {
  if (!args.title) die('--title is required');
  // Resolve the flags before the lookup, so a malformed command fails without a round trip.
  let description = resolveDescription(args);
  if (args.append && description === undefined) {
    die('--append needs the text to add — pass --description or --description-file with it.');
  }

  const milestone = findByTitle(base, args.title);
  if (args.append) description = appendDescription(milestone.description, description);

  const payload = {};
  if (args['new-title']) payload.title = args['new-title'];
  if (args.due) payload.due_on = `${args.due}T08:00:00Z`;
  if (description !== undefined) payload.description = description;
  if (Object.keys(payload).length === 0) {
    die(
      'Nothing to update — pass at least one of --new-title, --description, ' +
        '--description-file, --clear-description, --due',
    );
  }

  // The description is the release-direction record, so a replacement always shows what it
  // replaced. Print it BEFORE the write, so the text survives a failed write too. The wording says
  // "about to replace" for the same reason: the write below can still fail.
  if (payload.description !== undefined && !args.append) {
    if (isEmpty(milestone.description)) {
      info('This update replaces an empty description.');
    } else {
      info('This update is about to replace the description below. Copy it if you need it back:');
      for (const line of formatDescription(milestone.description, { full: true })) log(line);
    }
  }

  const updated = ghApiWrite('PATCH', `${base}/${milestone.number}`, payload);
  ok(`Updated milestone "${updated.title}" (#${updated.number}): ${updated.html_url}`);
  warnIfNoReleaseMarker(updated.description);
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
  let args;
  try {
    args = parseArgs(cliArgv(), PARSE_OPTIONS);
  } catch (error) {
    die(error.message);
  }
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
