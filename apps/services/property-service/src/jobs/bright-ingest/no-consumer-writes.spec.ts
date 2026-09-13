import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * #91 ships the ingestion vehicle and nothing that drives it: replication into a staging area is #92
 * and mapping into the consumer schema is #93. The acceptance criterion "no writes to any consumer
 * table, and no change to `listing_search_v` output — asserted by test" is this file.
 *
 * It is a source scan rather than a behavioural test for the same reason `seed.spec.ts` scans source
 * for the single-writer rule: the guarantee is "there is no such code path", and a behavioural test
 * can only demonstrate that the paths it happens to exercise do not write. It also keeps working
 * when #92 lands and this directory grows files nobody thought to add to a list — the scan reads the
 * directory, it does not enumerate it.
 *
 * WHEN #92 AND #93 LAND, this test does not simply get deleted. The consumer tables stay off-limits
 * to this directory: `src/db/write.ts` remains the only module that writes `listings`, and an
 * ingestion worker reaches it through that module (see the project guide, "Why Node, and what that
 * commits us to"). What #92 legitimately adds is its own staging table — so the allowance to make
 * then is a named staging table, never a relaxation of the consumer-table rule below.
 */

const JOB_DIR = __dirname;

/**
 * Every source file in this directory, specs included — a spec can open a connection too.
 *
 * This file is the one exclusion, and it is not a loophole: a scanner that must name the tokens it
 * forbids cannot be scanned for them. Everything this file could do wrong instead shows up as the
 * suite failing to prove anything, which the non-vacuity check below is for.
 */
const SCANNER_FILENAME = 'no-consumer-writes.spec.ts';

function jobSourceFiles(): string[] {
  return readdirSync(JOB_DIR)
    .filter((name) => name.endsWith('.ts') && name !== SCANNER_FILENAME)
    .sort();
}

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

describe('the Bright ingestion job writes nothing (#91 is the scaffold; #92/#93 do the work)', () => {
  it('scans a non-empty set of files, so a rename cannot make this suite vacuous', () => {
    expect(jobSourceFiles().length).toBeGreaterThanOrEqual(4);
  });

  it.each(CONSUMER_TABLES)('issues no INSERT, UPDATE or DELETE against %s', (table) => {
    for (const file of jobSourceFiles()) {
      const contents = readFileSync(join(JOB_DIR, file), 'utf8');
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
      expect(readFileSync(join(JOB_DIR, file), 'utf8')).not.toContain('listing_search_v');
    }
  });

  /**
   * Structural, not incidental: with no database import there is no connection to write through, so
   * the assertions above cannot be quietly bypassed by building SQL somewhere else and executing it
   * here. It is also why this job adds no migration — #91 introduces no database objects at all.
   */
  it('imports neither the connection pool nor the writer module', () => {
    for (const file of jobSourceFiles()) {
      const contents = readFileSync(join(JOB_DIR, file), 'utf8');
      expect(contents).not.toMatch(/from\s+'[^']*db\/pool'/);
      expect(contents).not.toMatch(/from\s+'[^']*db\/write'/);
      expect(contents).not.toMatch(/from\s+'pg'/);
    }
  });
});
