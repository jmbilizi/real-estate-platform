#!/usr/bin/env node

/**
 * Shows full ticket detail: issue body/labels/comments plus board field values
 * (Status/Priority/Size).
 *
 * Usage:
 *   pnpm run gh:ticket:view -- --issue 42
 */

const {
  ensureGhReady,
  requireConfig,
  loadSchema,
  ghJson,
  graphql,
  die,
  log,
} = require('./lib/gh-client');

const FIELD_VALUES_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) {
        projectItems(first: 20) {
          nodes {
            project { id }
            fieldValues(first: 20) {
              nodes {
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                  field { ... on ProjectV2SingleSelectField { name } }
                }
              }
            }
          }
        }
      }
    }
  }
`;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') continue; // pnpm forwards the literal '--' separator — never a flag
    if (!arg.startsWith('--')) continue;
    args[arg.slice(2)] = argv[i + 1];
    i++;
  }
  return args;
}

function main() {
  ensureGhReady();
  const { owner, repo } = requireConfig();
  const schema = loadSchema();
  const args = parseArgs(process.argv.slice(2));

  if (!args.issue) die('--issue <number> is required');

  const issue = ghJson([
    'issue',
    'view',
    args.issue,
    '--repo',
    `${owner}/${repo}`,
    '--json',
    'title,body,state,url,labels,comments,assignees,milestone',
  ]);

  const fieldResult = graphql(FIELD_VALUES_QUERY, { owner, repo, number: Number(args.issue) });
  const projectItem = fieldResult.data.repository.issue.projectItems.nodes.find(
    (node) => node.project.id === schema.projectId,
  );

  const fields = {};
  if (projectItem) {
    for (const fv of projectItem.fieldValues.nodes) {
      if (fv.field && fv.field.name) fields[fv.field.name] = fv.name;
    }
  }

  log(`# ${issue.title}  (#${args.issue}, ${issue.state})`);
  log(issue.url);
  log('');
  log(
    `Status: ${fields.Status || '—'}   Priority: ${fields.Priority || '—'}   Size: ${
      fields.Size || '—'
    }`,
  );
  log(`Labels: ${issue.labels.map((l) => l.name).join(', ') || '—'}`);
  log(`Milestone: ${issue.milestone ? issue.milestone.title : '—'}`);
  log(`Assignees: ${issue.assignees.map((a) => a.login).join(', ') || '—'}`);
  log('');
  log(issue.body || '(no description)');

  if (issue.comments.length) {
    log(`\n--- ${issue.comments.length} comment(s) ---`);
    for (const comment of issue.comments) {
      log(`\n[${comment.author.login} @ ${comment.createdAt}]`);
      log(comment.body);
    }
  }
}

main();
