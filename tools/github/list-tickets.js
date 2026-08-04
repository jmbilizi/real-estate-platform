#!/usr/bin/env node

/**
 * Lists tickets on the board, optionally filtered by Status/Priority/Size/scope, sorted by
 * Priority (board option order — first option is highest priority). "Ready to work" is
 * `--status Ready`, not a separate readiness field.
 *
 * Reads via GraphQL rather than `gh project item-list` because item-list's plain output
 * doesn't reliably expose custom single-select field values across gh versions, while the
 * ProjectV2 GraphQL schema (ProjectV2Item / ProjectV2ItemFieldSingleSelectValue) is stable
 * and gives field values directly.
 *
 * Usage:
 *   pnpm run gh:ticket:list -- --status Ready --priority P0
 *   pnpm run gh:ticket:list -- --scope cribstop --format json
 */

const { ensureGhReady, loadSchema, graphql, log } = require('./lib/gh-client');

const ITEMS_QUERY = `
  query($projectId: ID!, $after: String) {
    node(id: $projectId) {
      ... on ProjectV2 {
        items(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            content {
              ... on Issue {
                number
                title
                url
                state
                labels(first: 20) { nodes { name } }
                milestone { title dueOn }
              }
            }
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

function fetchAllItems(projectId) {
  const items = [];
  let after = null;
  let hasNextPage = true;

  while (hasNextPage) {
    // Omit `after` on the first page — GitHub rejects an empty-string cursor as invalid.
    const result = graphql(ITEMS_QUERY, after ? { projectId, after } : { projectId });
    const page = result.data.node.items;
    for (const node of page.nodes) {
      if (!node.content || !node.content.number) continue; // skip draft items
      const fields = {};
      for (const fv of node.fieldValues.nodes) {
        if (fv.field && fv.field.name) fields[fv.field.name] = fv.name;
      }
      items.push({
        itemId: node.id,
        number: node.content.number,
        title: node.content.title,
        url: node.content.url,
        state: node.content.state,
        labels: node.content.labels.nodes.map((l) => l.name),
        milestone: node.content.milestone ? node.content.milestone.title : null,
        milestoneDue: node.content.milestone ? node.content.milestone.dueOn : null,
        fields,
      });
    }
    hasNextPage = page.pageInfo.hasNextPage;
    after = page.pageInfo.endCursor;
  }

  return items;
}

function main() {
  ensureGhReady();
  const schema = loadSchema();
  const args = parseArgs(process.argv.slice(2));

  const items = fetchAllItems(schema.projectId);

  const priorityOrder = Object.keys(schema.fields.Priority?.options || {});

  // Field-value comparisons are case-insensitive to match resolveFieldOption — board-UI
  // casing edits ("In progress" vs "In Progress") must never break filtering.
  const eq = (a, b) => (a || '').toLowerCase() === (b || '').toLowerCase();
  const filtered = items.filter((item) => {
    if (args.status && !eq(item.fields.Status, args.status)) return false;
    if (args.priority && !eq(item.fields.Priority, args.priority)) return false;
    if (args.size && !eq(item.fields.Size, args.size)) return false;
    if (args.scope && !item.labels.includes(`scope:${args.scope}`)) return false;
    if (args.milestone && !eq(item.milestone, args.milestone)) return false;
    return true;
  });

  filtered.sort((a, b) => {
    const rankA = priorityOrder.indexOf(a.fields.Priority);
    const rankB = priorityOrder.indexOf(b.fields.Priority);
    return (rankA === -1 ? Infinity : rankA) - (rankB === -1 ? Infinity : rankB);
  });

  if (args.format === 'json') {
    console.log(JSON.stringify(filtered, null, 2));
    return;
  }

  if (filtered.length === 0) {
    log('No matching tickets.');
    return;
  }

  for (const item of filtered) {
    const milestone = item.milestone ? ` ⟶ ${item.milestone}` : '';
    log(
      `#${item.number} [${item.fields.Status || '—'} / ${item.fields.Priority || '—'} / ${
        item.fields.Size || '—'
      }] ${item.title}${milestone} — ${item.url}`,
    );
  }
}

main();
