/**
 * Shared `gh` CLI/GraphQL wrapper for the tools/github/*.js ticket scripts.
 *
 * Every script here fails loudly (non-zero exit, clear stderr) rather than falling back
 * silently — a ticket that half-creates (issue exists but isn't on the board, or is on the
 * board with the wrong fields) is worse than a script that refuses to proceed.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const config = require('../project.config.js');

const SCHEMA_PATH = path.join(__dirname, '..', 'project-schema.json');

const C = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

const log = (msg, c = '') => console.log(`${c}${msg}${C.reset}`);
const ok = (m) => log(`✓ ${m}`, C.green);
const warn = (m) => log(`⚠ ${m}`, C.yellow);
const info = (m) => log(`  ${m}`, C.cyan);

/** Print an error and exit(1). Every hard failure in these scripts goes through here. */
function die(message) {
  log(`✗ ${message}`, C.red);
  process.exit(1);
}

/** Run a command synchronously. Returns { success, stdout, stderr }. */
function run(cmd, args = [], opts = {}) {
  const result = spawnSync(cmd, args, {
    encoding: 'utf-8',
    shell: false,
    ...opts,
  });
  return {
    success: result.status === 0,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
  };
}

/** Run `gh` and parse its stdout as JSON. Dies with gh's own stderr on failure. */
function ghJson(args) {
  const result = run('gh', args);
  if (!result.success) {
    die(`gh ${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    die(`gh ${args.join(' ')} returned non-JSON output:\n${result.stdout}`);
  }
}

/** Run `gh` for its side effect (create/edit) and return raw stdout (usually a URL). */
function ghExec(args) {
  const result = run('gh', args);
  if (!result.success) {
    die(`gh ${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

/**
 * Run a GraphQL query/mutation via `gh api graphql`. Numbers/booleans are passed with -F
 * (typed), everything else with -f (string) — matches gh's own convention for this flag.
 */
function graphql(query, variables = {}) {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [key, value] of Object.entries(variables)) {
    const flag = typeof value === 'number' || typeof value === 'boolean' ? '-F' : '-f';
    args.push(flag, `${key}=${value}`);
  }
  return ghJson(args);
}

/** Verify `gh` is installed and authenticated. Dies with actionable instructions if not. */
function ensureGhReady() {
  const version = run('gh', ['--version']);
  if (!version.success) {
    die('`gh` (GitHub CLI) is not installed or not on PATH.\n' + '  Run: pnpm run gh:setup');
  }

  const auth = run('gh', ['auth', 'status']);
  if (!auth.success) {
    die('`gh` is installed but not authenticated.\n  Run: gh auth login');
  }
}

/** Load and validate the board config (owner/repo/projectNumber). Dies with setup steps if missing. */
function requireConfig() {
  if (!config.owner || !config.projectNumber) {
    die(
      'GitHub project board is not configured.\n' +
        '  1. Create the board (once):  gh project create --owner <org> --title "Cribstop Platform Backlog"\n' +
        '  2. Set GH_PROJECT_OWNER and GH_PROJECT_NUMBER env vars (or edit tools/github/project.config.js)\n' +
        '  3. Sync field IDs:           pnpm run gh:project:sync-schema',
    );
  }
  return config;
}

/** Load the cached field/option schema written by sync-project-schema.js. */
function loadSchema() {
  if (!fs.existsSync(SCHEMA_PATH)) {
    die('Project schema not found. Run: pnpm run gh:project:sync-schema');
  }
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf-8'));
  if (!schema.projectId || Object.keys(schema.fields).length === 0) {
    die('Project schema is empty/stale. Run: pnpm run gh:project:sync-schema');
  }
  return schema;
}

function saveSchema(schema) {
  fs.writeFileSync(SCHEMA_PATH, JSON.stringify(schema, null, 2) + '\n', 'utf-8');
}

const ITEM_LOOKUP_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) {
        projectItems(first: 20) {
          nodes {
            id
            project { id }
          }
        }
      }
    }
  }
`;

/** Resolve the ProjectV2Item id for an issue on the configured board. Dies if not found. */
function findProjectItemId(owner, repo, issueNumber, projectId) {
  const result = graphql(ITEM_LOOKUP_QUERY, { owner, repo, number: Number(issueNumber) });
  const issue = result.data.repository.issue;
  if (!issue) die(`Issue #${issueNumber} not found in ${owner}/${repo}`);

  const match = issue.projectItems.nodes.find((node) => node.project.id === projectId);
  if (!match) die(`Issue #${issueNumber} is not on the configured project board`);
  return match.id;
}

/**
 * Resolve a single-select field's { fieldId, optionId } for a given field/option name pair.
 * Option matching is case-insensitive so a board-UI casing edit ("In progress" vs
 * "In Progress") can never break the automation.
 */
function resolveFieldOption(schema, fieldName, optionName) {
  const field = schema.fields[fieldName];
  if (!field) {
    die(
      `Unknown field "${fieldName}". Known fields: ${Object.keys(schema.fields).join(', ')}\n` +
        '  If this field was added/renamed on the board, re-run: pnpm run gh:project:sync-schema',
    );
  }
  const optionKey = Object.keys(field.options).find(
    (name) => name.toLowerCase() === String(optionName).toLowerCase(),
  );
  if (!optionKey) {
    die(
      `Unknown option "${optionName}" for field "${fieldName}". Valid options: ` +
        Object.keys(field.options).join(', '),
    );
  }
  return { fieldId: field.id, optionId: field.options[optionKey] };
}

/**
 * Turns literal `\n` / `\t` escape sequences in a CLI-supplied string into real whitespace,
 * skipping Markdown code spans and fenced blocks.
 *
 * No shell interprets escapes inside a plain double-quoted argument, so a caller passing
 * `--body "## Problem\n\nText"` sends the two characters `\` and `n`. GitHub then renders the whole
 * ticket or comment as one unreadable line (see the original bodies of #29/#30).
 *
 * Prose is safe to normalize, but Windows paths are not: `C:\new\test` and `C:\temp` contain the
 * very sequences we rewrite, so a blanket replace would silently corrupt them into a newline and a
 * tab. Code is where verbatim paths belong in Markdown, so backticks are the discriminator — the
 * odd-indexed segments below are the captured code, and they pass through untouched. A bare path
 * outside backticks is still at risk; use a `--*-file` flag for anything that formatting matters
 * for, which is also the answer for multi-line text.
 */
const MARKDOWN_CODE_SEGMENT = /(```[\s\S]*?```|`[^`\n]*`)/;

function unescapeInlineText(text) {
  if (!text || !/\\[nt]/.test(text)) return text;
  return text
    .split(MARKDOWN_CODE_SEGMENT)
    .map((segment, index) =>
      index % 2 === 1
        ? segment
        : segment
            .replace(/\\r\\n/g, '\n')
            .replace(/\\n/g, '\n')
            .replace(/\\t/g, '\t'),
    )
    .join('');
}

module.exports = {
  config,
  log,
  ok,
  warn,
  info,
  die,
  unescapeInlineText,
  run,
  ghJson,
  ghExec,
  graphql,
  ensureGhReady,
  requireConfig,
  loadSchema,
  saveSchema,
  findProjectItemId,
  resolveFieldOption,
  SCHEMA_PATH,
};
