#!/usr/bin/env node

/**
 * Posts a comment on an issue or a pull request (cribstop-product-owner tool).
 *
 * Without it the product owner can replace a ticket body but cannot add a comment, so every
 * cross-lane note — a ratified split, an answer to an engineer's question, a priority rationale —
 * has to be written into the spec sections. That is heavier, it is lossier, and it blurs the
 * body split that update-ticket-fields.js and update-ticket-status.js exist to enforce.
 *
 * A comment never touches the issue body, so the Implementation Plan block is out of reach here.
 *
 * Usage:
 *   pnpm run gh:comment -- --issue 42 --body-file ./note.md
 *   pnpm run gh:comment -- --pr 139 --body-file ./note.md
 *   pnpm run gh:comment -- --issue 42 --body "Unblocked: #127 shipped in PR #139."
 */

const fs = require('fs');

const {
  ensureGhReady,
  requireConfig,
  ghExec,
  unescapeInlineText,
  die,
  ok,
  info,
} = require('./lib/gh-client');
const { parseArgs } = require('./lib/args');

/** Validates a `--body-file` path the same way update-ticket-fields.js validates its own. */
function readBodyFile(file) {
  if (!fs.existsSync(file)) throw new Error(`--body-file not found: ${file}`);
  // existsSync is true for a directory too, and the read would then throw a raw EISDIR.
  if (fs.statSync(file).isDirectory()) {
    throw new Error(`--body-file is a directory, not a file: ${file}`);
  }
  const body = fs.readFileSync(file, 'utf-8');
  if (!body.trim()) throw new Error(`--body-file is empty: ${file}`);
  return body;
}

function main() {
  ensureGhReady();
  const { owner, repo } = requireConfig();
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    die(error.message);
  }

  if (args.issue && args.pr) die('Provide either --issue or --pr, not both');
  const target = args.issue ? 'issue' : args.pr ? 'pr' : null;
  if (!target) die('--issue <number> or --pr <number> is required');
  const number = args.issue || args.pr;

  if (args['body-file'] && args.body) die('Provide either --body-file or --body, not both');
  if (!args['body-file'] && !args.body) die('--body-file <path> or --body "<text>" is required');

  const commentArgs = ['comment', number, '--repo', `${owner}/${repo}`];
  if (args['body-file']) {
    // gh reads the file itself, so a long markdown comment never reaches the command line.
    try {
      readBodyFile(args['body-file']);
    } catch (error) {
      die(error.message);
    }
    commentArgs.push('--body-file', args['body-file']);
  } else {
    const body = unescapeInlineText(args.body);
    if (body !== args.body) {
      info(
        'Body contained literal \\n / \\t escapes — unescaping. Prefer --body-file for markdown.',
      );
    }
    commentArgs.push('--body', body);
  }

  const url = ghExec([target, ...commentArgs]);
  ok(`Commented on ${target === 'pr' ? 'PR' : 'issue'} #${number}: ${url}`);
}

if (require.main === module) main();

module.exports = { readBodyFile };
