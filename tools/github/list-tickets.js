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
 * Closed issues are left out by default. A declined ticket (gh:ticket:update-fields --decline) keeps
 * whatever Status it had, so without this filter `--status Ready` would keep offering it to
 * pick-next-ticket and the engineer would build work the product owner just refused. Pass
 * `--state closed` or `--state all` to see them.
 *
 * Usage:
 *   pnpm run gh:ticket:list -- --status Ready --priority P0
 *   pnpm run gh:ticket:list -- --scope cribstop --format json
 *   pnpm run gh:ticket:list -- --state all --status Done
 */

const { ensureGhReady, loadSchema, graphql, log, die } = require('./lib/gh-client');
const { parseArgs } = require('./lib/args');

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

// Field-value comparisons are case-insensitive to match resolveFieldOption — board-UI
// casing edits ("In progress" vs "In Progress") must never break filtering.
const eq = (a, b) => (a || '').toLowerCase() === (b || '').toLowerCase();

const STATES = ['open', 'closed', 'all'];

/** Applies --state (default open) and the field/label filters. Throws on an unknown --state. */
function filterItems(items, args) {
  const state = (args.state || 'open').toLowerCase();
  if (!STATES.includes(state)) {
    throw new Error(`--state must be open, closed or all (got "${args.state}")`);
  }

  return items.filter((item) => {
    if (state !== 'all' && !eq(item.state, state)) return false;
    if (args.status && !eq(item.fields.Status, args.status)) return false;
    if (args.priority && !eq(item.fields.Priority, args.priority)) return false;
    if (args.size && !eq(item.fields.Size, args.size)) return false;
    if (args.scope && !item.labels.includes(`scope:${args.scope}`)) return false;
    if (args.milestone && !eq(item.milestone, args.milestone)) return false;
    return true;
  });
}

function main() {
  ensureGhReady();
  const schema = loadSchema();
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    die(error.message);
  }

  const items = fetchAllItems(schema.projectId);

  const priorityOrder = Object.keys(schema.fields.Priority?.options || {});

  let filtered;
  try {
    filtered = filterItems(items, args);
  } catch (error) {
    die(error.message);
  }

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
    const openOnly = !args.state || eq(args.state, 'open');
    log(
      openOnly
        ? 'No matching open tickets. Add --state all to include closed ones.'
        : 'No matching tickets.',
    );
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

if (require.main === module) main();

module.exports = { filterItems };
