import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Structural guards over who writes which table, and what they may write into it. These moved here
 * from the removed seed module (#340) — they were never about the seeder, only anchored to it as a
 * convenient home at the time.
 */

/** Every `.ts` file under a directory, recursively. */
function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return collectSourceFiles(path);
    }
    return entry.isFile() && path.endsWith('.ts') ? [path] : [];
  });
}

describe('listings write path', () => {
  /**
   * The dwelling snapshot on `listings` is drift-capable by construction: no database constraint can
   * assert it equals COALESCE(unit, property), because for a terminal listing that equality is
   * deliberately false. The containment is therefore structural — exactly one module writes the table.
   *
   * This test is that enforcement. If it fails, do not add another writer; extend src/db/write.ts.
   */
  it('is confined to src/db/write.ts', () => {
    const sourceRoot = join(__dirname, '..');
    const sourceFiles = collectSourceFiles(sourceRoot).filter(
      (path) => !path.endsWith(join('db', 'write.ts')) && !path.endsWith('.spec.ts'),
    );
    expect(sourceFiles.length).toBeGreaterThan(5);

    for (const absolutePath of sourceFiles) {
      const contents = readFileSync(absolutePath, 'utf8');
      expect(contents).not.toMatch(/INSERT\s+INTO\s+listings\b/i);
      expect(contents).not.toMatch(/UPDATE\s+listings\b/i);
      // DELETE is checked too, since write.ts also carries a bulk removal path
      // (`deleteSampleData`). A stray DELETE elsewhere is strictly more dangerous than a stray
      // INSERT.
      expect(contents).not.toMatch(/DELETE\s+FROM\s+listings\b/i);
    }
  });
});

describe('MLS attribute model write path', () => {
  /**
   * The same containment, mirrored onto the attribute store (#127).
   *
   * The reason differs from the listings one and is worth keeping distinct: the attribute model's
   * invariants ARE enforceable in the database (composite foreign keys do it), so this is not the only
   * thing standing between a caller and a bad row. What one writer buys is the fail-closed BEHAVIOUR —
   * an unregistered value detected and reported as a rejection instead of raising a constraint
   * violation that aborts the whole ingest transaction. A second writer would get the rejection right
   * on Monday and abort a batch on Tuesday.
   *
   * Note the symmetry: `write.ts` is checked here too. The two modules own different tables and
   * neither may reach into the other's.
   */
  const ATTRIBUTE_TABLES = [
    'mls_fields',
    'mls_lookup_values',
    'listing_attributes',
    'property_attributes',
  ];

  it('is confined to src/db/mls-attributes.ts', () => {
    // Every source file under src/ EXCEPT the writer itself, discovered rather than enumerated.
    //
    // A hardcoded allowlist would not cover the two modules most likely to become the second writer —
    // the `$metadata` sync (#91) and the ingestion writer (#93), which are the whole reason this model
    // exists and do not exist yet. They would simply not be in the list, and the rule would stop being
    // enforced with nothing failing to say so.
    const sourceRoot = join(__dirname, '..');
    const sourceFiles = collectSourceFiles(sourceRoot).filter(
      (path) => !path.endsWith(join('db', 'mls-attributes.ts')) && !path.endsWith('.spec.ts'),
    );
    expect(sourceFiles.length).toBeGreaterThan(5);

    for (const absolutePath of sourceFiles) {
      const contents = readFileSync(absolutePath, 'utf8');
      for (const table of ATTRIBUTE_TABLES) {
        expect(contents).not.toMatch(new RegExp(`INSERT\\s+INTO\\s+${table}\\b`, 'i'));
        expect(contents).not.toMatch(new RegExp(`UPDATE\\s+${table}\\b`, 'i'));
        expect(contents).not.toMatch(new RegExp(`DELETE\\s+FROM\\s+${table}\\b`, 'i'));
      }
    }
  });

  it('does not write listings, which belongs to src/db/write.ts', () => {
    const contents = readFileSync(join(__dirname, 'mls-attributes.ts'), 'utf8');
    expect(contents).not.toMatch(/INSERT\s+INTO\s+listings\b/i);
    expect(contents).not.toMatch(/UPDATE\s+listings\b/i);
    expect(contents).not.toMatch(/DELETE\s+FROM\s+listings\b/i);
  });
});

describe('sample data never carries an internal source', () => {
  /**
   * Stakeholder ruling 2026-09-26 (#340): no environment holds sample or test-feed data any more.
   * The removed seeder was the one production code path that paired `is_sample: true` with
   * `source: 'internal'` on a `listings` row. This guards against that pairing coming back.
   *
   * Two kinds of file are excluded, both deliberately, both test-only:
   *  - `*.spec.ts` — unit test bodies.
   *  - `*test-fixtures.ts` — e.g. `src/listings/test-fixtures.ts`, which builds a listing ROW SHAPE
   *    for mapper/read-model tests. It never issues a write; excluding it is the same reasoning as
   *    excluding `tests/support/fixtures.ts` (a disposable e2e fixture, gated by
   *    `PROPERTY_SERVICE_E2E_FIXTURES`), which lives outside `src/` entirely and is never in scope
   *    here regardless.
   */
  it("pairs no src/ file with both is_sample: true and source: 'internal'", () => {
    const sourceRoot = join(__dirname, '..');
    const sourceFiles = collectSourceFiles(sourceRoot).filter(
      (path) => !path.endsWith('.spec.ts') && !path.endsWith('test-fixtures.ts'),
    );
    expect(sourceFiles.length).toBeGreaterThan(5);

    const SAMPLE_FLAG = /is_sample:\s*true/;
    const INTERNAL_SOURCE = /source:\s*'internal'/;

    for (const absolutePath of sourceFiles) {
      const contents = readFileSync(absolutePath, 'utf8');
      const bothPresent = SAMPLE_FLAG.test(contents) && INTERNAL_SOURCE.test(contents);
      expect(bothPresent).toBe(false);
    }
  });
});
