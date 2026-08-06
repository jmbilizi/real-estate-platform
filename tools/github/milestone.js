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
 * The gh CLI has no native milestone command, so CRUD goes through the REST API; assignment to
 * tickets goes through `gh:ticket:create/update-fields -- --milestone "<title>"`.
 *
 * Usage:
 *   pnpm run gh:milestone -- list [--all]
 *   pnpm run gh:milestone -- create --title "Services MVP" [--due 2026-09-15] [--description "..."]
 *   pnpm run gh:milestone -- update --title "Services MVP" [--new-title "..."] [--description "..."] [--due 2026-09-15]
 *   pnpm run gh:milestone -- close --title "Services MVP"
 *   pnpm run gh:milestone -- delete --title "Services MVP"
 */

const {
  ensureGhReady,
  requireConfig,
  ghJson,
  ghExec,
  unescapeInlineText,
  die,
  ok,
  log,
} = require('./lib/gh-client');

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
    if (key === 'all') {
      args.all = true;
    } else {
      args[key] = argv[i + 1];
      i++;
    }
  }
  return args;
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

function main() {
  ensureGhReady();
  const { owner, repo } = requireConfig();
  const args = parseArgs(process.argv.slice(2));
  const base = `repos/${owner}/${repo}/milestones`;
  const command = args._[0];

  if (command === 'list' || !command) {
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
    }
    return;
  }

  if (command === 'create') {
    if (!args.title) die('--title is required');
    const apiArgs = ['api', '--method', 'POST', base, '-f', `title=${args.title}`];
    // T08:00:00Z (US-Pacific midnight) is GitHub's own storage convention for milestone due
    // dates — midnight UTC gets rendered as the *previous* day.
    if (args.due) apiArgs.push('-f', `due_on=${args.due}T08:00:00Z`);
    if (args.description) apiArgs.push('-f', `description=${unescapeInlineText(args.description)}`);
    const created = JSON.parse(ghExec(apiArgs));
    ok(`Created milestone "${created.title}" (#${created.number}): ${created.html_url}`);
    return;
  }

  if (command === 'update') {
    if (!args.title) die('--title is required');
    const milestone = findByTitle(base, args.title);
    const apiArgs = ['api', '--method', 'PATCH', `${base}/${milestone.number}`];
    if (args['new-title']) apiArgs.push('-f', `title=${args['new-title']}`);
    if (args.description !== undefined)
      apiArgs.push('-f', `description=${unescapeInlineText(args.description)}`);
    if (args.due) apiArgs.push('-f', `due_on=${args.due}T08:00:00Z`);
    if (apiArgs.length === 4) {
      die('Nothing to update — pass at least one of --new-title, --description, --due');
    }
    const updated = JSON.parse(ghExec(apiArgs));
    ok(`Updated milestone "${updated.title}" (#${updated.number}): ${updated.html_url}`);
    return;
  }

  if (command === 'close') {
    if (!args.title) die('--title is required');
    const milestone = findByTitle(base, args.title);
    if (milestone.open_issues > 0) {
      die(
        `Milestone "${milestone.title}" still has ${milestone.open_issues} open issue(s) — ` +
          'an epic closes when its scope is delivered. Ship them, or move them out ' +
          '(gh:ticket:update-fields -- --issue <n> --remove-milestone) if they were descoped.',
      );
    }
    ghExec(['api', '--method', 'PATCH', `${base}/${milestone.number}`, '-f', 'state=closed']);
    ok(`Closed milestone "${milestone.title}"`);
    return;
  }

  if (command === 'delete') {
    if (!args.title) die('--title is required');
    const milestone = findByTitle(base, args.title);
    if (milestone.open_issues > 0) {
      die(
        `Milestone "${milestone.title}" still has ${milestone.open_issues} open issue(s) — ` +
          'reassign or close them first (deleting would silently detach them).',
      );
    }
    ghExec(['api', '--method', 'DELETE', `${base}/${milestone.number}`]);
    ok(`Deleted milestone "${milestone.title}"`);
    return;
  }

  die(`Unknown command "${command}". Use: list | create | update | close | delete`);
}

main();
