#!/usr/bin/env node

/**
 * Repo label CRUD (cribstop-product-owner tool). A ticket can only carry a label that already
 * exists on the repo: `gh issue create`/`gh issue edit` reject an unknown one. Without this
 * wrapper a new component keeps `scope:shared` for ever, because nothing in the product-owner
 * lane can create `scope:<component>`.
 *
 * `create` refuses a name that already exists instead of overwriting its colour and description.
 * Pass --update to change an existing label on purpose.
 *
 * Usage:
 *   pnpm run gh:label -- list [--search scope:]
 *   pnpm run gh:label -- create --name scope:property-service --color 1D76DB --description "..."
 *   pnpm run gh:label -- create --name scope:property-service --color 1D76DB --update
 */

const {
  ensureGhReady,
  cliArgv,
  requireConfig,
  ghJson,
  ghExec,
  unescapeInlineText,
  die,
  ok,
  log,
} = require('./lib/gh-client');
const { parseArgs } = require('./lib/args');

const PARSE_OPTIONS = { flags: ['update'], positionals: true };

/** GitHub stores a colour as six hex digits with no leading '#'. Accept either form. */
function normalizeColor(raw) {
  const color = String(raw).trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(color)) {
    throw new Error(`--color must be 6 hex digits (got "${raw}")`);
  }
  return color.toLowerCase();
}

/**
 * Every label on the repo. `gh label list` needs a `--limit`, and a limit that silently truncates
 * turns the duplicate check below into a wrong answer — it would report "no match" and create a
 * near-duplicate. `gh api --paginate --slurp` returns one array per page instead, so there is no
 * cap to get wrong.
 */
function listLabels(owner, repo) {
  const pages = ghJson([
    'api',
    '--paginate',
    '--slurp',
    `repos/${owner}/${repo}/labels?per_page=100`,
  ]);
  return pages.flat();
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
  const repoRef = ['--repo', `${owner}/${repo}`];
  const command = args._[0];

  if (command === 'list' || !command) {
    const search = args.search ? String(args.search).toLowerCase() : null;
    const labels = listLabels(owner, repo).filter(
      (label) => !search || label.name.toLowerCase().includes(search),
    );
    if (labels.length === 0) {
      log(search ? `No label matches "${args.search}".` : 'No labels.');
      return;
    }
    for (const label of labels) {
      log(`${label.name}  #${label.color}  ${label.description || ''}`.trimEnd());
    }
    return;
  }

  if (command === 'create') {
    if (!args.name) die('--name is required');
    if (!args.color) die('--color is required (6 hex digits, e.g. 1D76DB)');

    let color;
    try {
      color = normalizeColor(args.color);
    } catch (error) {
      die(error.message);
    }
    const description = args.description ? unescapeInlineText(args.description) : null;

    // Look first, so an existing name is a clear refusal rather than a silent overwrite. `gh label
    // create` on its own reports the conflict, but only --force resolves it, and --force replaces
    // colour and description with whatever this call happened to pass.
    const existing = listLabels(owner, repo).find(
      (label) => label.name.toLowerCase() === String(args.name).toLowerCase(),
    );

    if (existing && !args.update) {
      die(
        `Label "${existing.name}" already exists (#${existing.color}). ` +
          'Nothing was written. Use --update to change its colour or description.',
      );
    }

    const writeArgs = existing
      ? ['label', 'edit', existing.name, ...repoRef, '--color', color]
      : ['label', 'create', args.name, ...repoRef, '--color', color];
    if (description !== null) writeArgs.push('--description', description);

    ghExec(writeArgs);
    ok(existing ? `Updated label "${existing.name}"` : `Created label "${args.name}"`);
    return;
  }

  die(`Unknown command "${command}". Use: list | create`);
}

if (require.main === module) main();

module.exports = { normalizeColor };
