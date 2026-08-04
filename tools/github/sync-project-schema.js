#!/usr/bin/env node

/**
 * Introspects the Projects v2 board and caches field/option IDs to project-schema.json.
 *
 * `gh project item-edit` needs field and single-select-option IDs (UUIDs), not the human
 * names shown on the board — this script resolves them once so create-ticket.js /
 * update-ticket-fields.js don't re-query the board on every call.
 *
 * Usage:
 *   pnpm run gh:project:sync-schema
 */

const {
  ensureGhReady,
  requireConfig,
  ghJson,
  saveSchema,
  ok,
  info,
  log,
} = require('./lib/gh-client');

function main() {
  ensureGhReady();
  const { owner, projectNumber } = requireConfig();

  info(`Reading project #${projectNumber} (owner: ${owner})...`);
  const project = ghJson([
    'project',
    'view',
    String(projectNumber),
    '--owner',
    owner,
    '--format',
    'json',
  ]);

  const fieldList = ghJson([
    'project',
    'field-list',
    String(projectNumber),
    '--owner',
    owner,
    '--format',
    'json',
  ]);

  const fields = {};
  for (const field of fieldList.fields || []) {
    const options = {};
    for (const option of field.options || []) {
      options[option.name] = option.id;
    }
    fields[field.name] = { id: field.id, type: field.type, options };
  }

  const schema = {
    projectId: project.id,
    syncedAt: new Date().toISOString(),
    fields,
  };
  saveSchema(schema);

  ok(
    `Synced ${Object.keys(fields).length} field(s) from "${project.title}" into project-schema.json`,
  );
  for (const [name, field] of Object.entries(fields)) {
    const optionNames = Object.keys(field.options);
    log(`  • ${name}${optionNames.length ? ` — ${optionNames.join(' / ')}` : ''}`);
  }
}

main();
