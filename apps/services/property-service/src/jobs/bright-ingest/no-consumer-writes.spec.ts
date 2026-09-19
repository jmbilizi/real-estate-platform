import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

/**
 * The structural guards over this directory.
 *
 * #91 shipped the ingestion vehicle and asserted that it wrote nothing at all. #92 makes it write —
 * but only to its own staging tables. So the guard changes shape rather than going away, and it
 * changes in the direction the #91 version prescribed: **the allowance is a named staging table,
 * never a relaxation of the consumer-table rule.**
 *
 * Three rules are enforced here, all as source scans rather than behavioural tests. A behavioural
 * test can only demonstrate that the paths it happens to exercise behave; the claim is that there is
 * no such code path at all. The scan also keeps working as this directory grows files nobody thought
 * to add to a list, because it reads the directory rather than enumerating it.
 *
 *  1. **Only the staging tables are written.** Every table named in write SQL must be on the
 *     allowlist. This is stronger than the #91 version, which listed the tables to forbid: a new
 *     consumer table added by a later migration is caught without anyone remembering to add it here.
 *  2. **`src/db/write.ts` stays the only module that writes `listings`.** This directory never
 *     imports it. `db/pool` IS imported now, by the staging store and the program entry, because a
 *     staging write needs a connection — so the import is allowlisted per file rather than banned.
 *  3. **`$orderby` appears in one module.** An ordered Bright query with no bounding filter runs
 *     past 300 seconds and never returns. `odata-query.ts` cannot emit one; no other module may try.
 */

const JOB_DIR = __dirname;

/**
 * This file is the one exclusion, and it is not a loophole: a scanner that must name the tokens it
 * forbids cannot be scanned for them. Everything this file could do wrong instead shows up as the
 * suite failing to prove anything, which the non-vacuity check below is for.
 */
const SCANNER_FILENAME = 'no-consumer-writes.spec.ts';

/**
 * Recursive on purpose. A natural layout for this job is a subdirectory, and a flat `readdirSync`
 * would leave every file in it silently unscanned while the suite still passed green — the precise
 * failure this guard is supposed to make impossible.
 */
function jobSourceFiles(): string[] {
  return readdirSync(JOB_DIR, { recursive: true })
    .map((entry) => String(entry))
    .filter((name) => name.endsWith('.ts') && basename(name) !== SCANNER_FILENAME)
    .sort();
}

function read(file: string): string {
  return readFileSync(join(JOB_DIR, file), 'utf8');
}

/**
 * The file with its comments removed.
 *
 * Every rule below is about what the code DOES. Scanning the prose as well produces two kinds of
 * false alarm that are worse than no scan: a doc comment explaining why an unbounded `$orderby` is
 * forbidden reads as an emitter, and a sentence containing the word "insert" reads as write SQL.
 * Both push the next person to reword a comment to satisfy a test, which teaches exactly the wrong
 * lesson about what the guard is for.
 */
function codeOf(file: string): string {
  return read(file)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** The only tables this job may write. #93 maps out of them into the consumer schema. */
const STAGING_TABLES = ['bright_staging_records', 'bright_replication_cursor'];

/** Kept explicit as well, so the failure message names the rule that was broken. */
const CONSUMER_TABLES = [
  'properties',
  'units',
  'listings',
  'communities',
  'listing_media',
  'listing_open_houses',
  'listing_events',
  'seed_state',
];

/** Files allowed to open a database connection. Anything else has no business holding one. */
const POOL_IMPORTERS = ['staging-store.ts', 'bright-ingest.main.ts'];

/** The single module allowed to write an OData `$orderby`. Specs and the mock read it, not emit it. */
const ORDERBY_EMITTER = 'odata-query.ts';

/**
 * `DO UPDATE` is excluded because it names no table — it is the tail of `ON CONFLICT ... DO UPDATE
 * SET`, and matching it would capture the keyword `SET` as a table name.
 */
const WRITE_STATEMENT = /\b(?:INSERT\s+INTO|(?<!DO\s)UPDATE|DELETE\s+FROM)\s+([A-Za-z_][\w.]*)/gi;

describe('the Bright ingestion job writes staging tables and nothing else', () => {
  it('scans a non-empty set of files, so a rename cannot make this suite vacuous', () => {
    expect(jobSourceFiles().length).toBeGreaterThanOrEqual(8);
  });

  /**
   * The allowlist, not a denylist. A consumer table added by a later migration is refused here with
   * no edit to this file, which is the failure mode the #91 version could not catch.
   */
  it('names only staging tables in write SQL', () => {
    const offenders: string[] = [];
    for (const file of jobSourceFiles()) {
      for (const match of codeOf(file).matchAll(WRITE_STATEMENT)) {
        const table = (match[1] ?? '').toLowerCase();
        if (!STAGING_TABLES.includes(table)) {
          offenders.push(`${file}: ${match[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it.each(CONSUMER_TABLES)('issues no INSERT, UPDATE or DELETE against %s', (table) => {
    for (const file of jobSourceFiles()) {
      const contents = codeOf(file);
      expect(contents).not.toMatch(new RegExp(`INSERT\\s+INTO\\s+${table}\\b`, 'i'));
      expect(contents).not.toMatch(new RegExp(`UPDATE\\s+${table}\\b`, 'i'));
      expect(contents).not.toMatch(new RegExp(`DELETE\\s+FROM\\s+${table}\\b`, 'i'));
    }
  });

  /**
   * `listing_search_v` enforces the display rules for every consumer read. The criterion is that its
   * output is unchanged by this ticket, and the way to guarantee that is for this directory not to
   * touch the view — or the migration chain that defines it — at all.
   */
  it('does not reference listing_search_v', () => {
    for (const file of jobSourceFiles()) {
      expect(read(file)).not.toContain('listing_search_v');
    }
  });

  /**
   * `src/db/write.ts` remains the only module that writes `listings`. An ingestion worker reaches
   * the consumer schema through it, never around it — see the project guide, "Why Node, and what
   * that commits us to".
   */
  it('imports the writer module nowhere', () => {
    for (const file of jobSourceFiles()) {
      expect(read(file)).not.toMatch(/from\s+'[^']*db\/write'/);
    }
  });

  it('opens a database connection only where a staging write needs one', () => {
    for (const file of jobSourceFiles()) {
      if (POOL_IMPORTERS.includes(basename(file))) {
        continue;
      }
      const contents = read(file);
      expect(contents).not.toMatch(/from\s+'[^']*db\/pool'/);
      expect(contents).not.toMatch(/from\s+'pg'/);
    }
  });
});

describe('an ordered Bright query is always bounded', () => {
  /**
   * Observed 2026-09-18: a bare `$orderby=ModificationTimestamp asc` runs past 300 seconds and the
   * request dies; the same query with a bounding `$filter` returns in 3.3 seconds. `buildCursorQuery`
   * has no argument shape that produces one without the other, and this keeps a second emitter from
   * appearing beside it.
   */
  it('is written in exactly one module', () => {
    const emitters = jobSourceFiles().filter(
      (file) => !file.endsWith('.spec.ts') && codeOf(file).includes('$orderby'),
    );
    expect(emitters.filter((file) => basename(file) !== 'mock-reso-server.ts')).toEqual([
      ORDERBY_EMITTER,
    ]);
  });
});
