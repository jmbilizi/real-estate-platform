/* eslint-disable @typescript-eslint/no-require-imports */
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * #755. A plain `CREATE INDEX` on a table the sync writes to blocks every write for the whole
 * build. The sync stalls, its transactions pile up, and API reads time out behind the pile. Migration
 * 055 did this on `listings`. The repo rule since #388: build an index on a sync table with
 * `CONCURRENTLY`, in a migration with `pgm.noTransaction()` (`CREATE INDEX CONCURRENTLY` cannot run
 * inside a transaction block).
 *
 * This spec runs the `up()` of every migration after the cutoff against a recording stand-in for
 * `pgm`, and fails when one of them builds an index on a sync table any other way.
 */

/** Tables that the Bright sync, or a request path, writes to while the service runs. */
const SYNC_TABLES = [
  'listings',
  'properties',
  'units',
  'listing_media',
  'listing_events',
  'listing_open_houses',
  'listing_facts',
  'listing_attributes',
  'property_attributes',
] as const;

/**
 * The first migration the rule applies to. Every migration before it ran already. Migration 055
 * built `idx_listings_live_property` the plain way before this guard existed, and an applied
 * migration never changes.
 */
const FIRST_GUARDED_MIGRATION = 1785801600059;

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations');

interface Recorded {
  readonly noTransaction: boolean;
  readonly indexes: { table: string; concurrently: boolean }[];
  readonly sql: string[];
}

interface Pgm {
  noTransaction: () => void;
  createIndex: (
    table: unknown,
    columns: unknown,
    options?: { concurrently?: boolean; name?: string },
  ) => void;
  sql: (text: string) => void;
}
type Migration = { up: (pgm: Pgm) => void };

/** Runs `up()` against a recorder. Every other `pgm` call is a no-op. */
function recordUp(migration: Migration): Recorded {
  const recorded: { noTransaction: boolean; indexes: Recorded['indexes']; sql: string[] } = {
    noTransaction: false,
    indexes: [],
    sql: [],
  };
  const addIndex = (
    table: unknown,
    _columns: unknown,
    options?: { concurrently?: boolean; name?: string },
  ) => {
    recorded.indexes.push({
      table:
        typeof table === 'string' ? table : String((table as { name?: string })?.name ?? table),
      concurrently: options?.concurrently === true,
    });
  };
  const pgm = new Proxy(
    {
      noTransaction: () => {
        recorded.noTransaction = true;
      },
      createIndex: addIndex,
      addIndex,
      sql: (text: string) => {
        recorded.sql.push(text);
      },
      func: (name: string) => name,
      // A migration may call `pgm.func(...)` or `pgm.getContext()`; the recorder ignores both.
    } as Record<string, unknown>,
    { get: (target, key: string) => target[key] ?? (() => undefined) },
  );
  migration.up(pgm as unknown as Pgm);
  return recorded;
}

const CREATE_INDEX = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!CONCURRENTLY)/i;
const CREATE_INDEX_ANY =
  /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?\S+\s+ON\s+(?:ONLY\s+)?"?(?:public"?\."?)?(\w+)/gi;

/** The reasons a migration breaks the rule. An empty list means it keeps it. */
function indexRuleViolations(migration: Migration): string[] {
  const recorded = recordUp(migration);
  const problems: string[] = [];

  for (const index of recorded.indexes) {
    if (!(SYNC_TABLES as readonly string[]).includes(index.table)) continue;
    if (!index.concurrently) {
      problems.push(`createIndex on "${index.table}" without concurrently: true`);
    }
    if (index.concurrently && !recorded.noTransaction) {
      problems.push(
        `createIndex on "${index.table}" is concurrent but the migration has no pgm.noTransaction()`,
      );
    }
  }

  for (const text of recorded.sql) {
    for (const match of text.matchAll(CREATE_INDEX_ANY)) {
      const table = match[1] ?? '';
      if (!(SYNC_TABLES as readonly string[]).includes(table)) continue;
      if (CREATE_INDEX.test(match[0])) {
        problems.push(`raw CREATE INDEX on "${table}" without CONCURRENTLY`);
      } else if (!recorded.noTransaction) {
        problems.push(`raw CREATE INDEX CONCURRENTLY on "${table}" but no pgm.noTransaction()`);
      }
    }
  }
  return problems;
}

function migrationNumber(file: string): number {
  return Number(file.split('_')[0]);
}

describe('migration index guard (#755)', () => {
  const guarded = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.js') && migrationNumber(file) >= FIRST_GUARDED_MIGRATION)
    .sort();

  for (const file of guarded) {
    it(`${file} builds no blocking index on a sync table`, () => {
      const migration = require(path.join(MIGRATIONS_DIR, file)) as Migration;
      expect(indexRuleViolations(migration)).toEqual([]);
    });
  }

  it('reads the migrations directory', () => {
    expect(fs.readdirSync(MIGRATIONS_DIR).length).toBeGreaterThan(50);
  });

  describe('the detector', () => {
    it('flags a plain createIndex on listings', () => {
      const bad = { up: (pgm: Pgm) => pgm.createIndex('listings', ['id'], { name: 'x' }) };
      expect(indexRuleViolations(bad)).toEqual([
        'createIndex on "listings" without concurrently: true',
      ]);
    });

    it('flags a concurrent createIndex that stays in a transaction', () => {
      const bad = {
        up: (pgm: Pgm) => pgm.createIndex('listings', ['id'], { name: 'x', concurrently: true }),
      };
      expect(indexRuleViolations(bad)).toHaveLength(1);
    });

    it('accepts a concurrent createIndex in a non-transactional migration', () => {
      const good = {
        up: (pgm: Pgm) => {
          pgm.noTransaction();
          pgm.createIndex('listings', ['id'], { name: 'x', concurrently: true });
        },
      };
      expect(indexRuleViolations(good)).toEqual([]);
    });

    it('flags raw CREATE INDEX SQL without CONCURRENTLY', () => {
      const bad = { up: (pgm: Pgm) => pgm.sql('CREATE INDEX idx_x ON listings (id)') };
      expect(indexRuleViolations(bad)).toEqual([
        'raw CREATE INDEX on "listings" without CONCURRENTLY',
      ]);
    });

    it('accepts raw CREATE INDEX CONCURRENTLY with noTransaction', () => {
      const good = {
        up: (pgm: Pgm) => {
          pgm.noTransaction();
          pgm.sql('CREATE INDEX CONCURRENTLY idx_x ON listings (id)');
        },
      };
      expect(indexRuleViolations(good)).toEqual([]);
    });

    it('ignores an index on a table the sync does not write to', () => {
      const other = { up: (pgm: Pgm) => pgm.createIndex('lead_notes', ['id'], { name: 'x' }) };
      expect(indexRuleViolations(other)).toEqual([]);
    });

    it('finds the plain index that migration 055 built', () => {
      const m055 = require(
        path.join(MIGRATIONS_DIR, '1785801600055_add-listing-collapse-support.js'),
      ) as Migration;
      expect(indexRuleViolations(m055)).toEqual([
        'createIndex on "listings" without concurrently: true',
      ]);
    });

    it('accepts migration 057, which builds its index concurrently', () => {
      const m057 = require(
        path.join(MIGRATIONS_DIR, '1785801600057_add-listing-office-key-index.js'),
      ) as Migration;
      expect(indexRuleViolations(m057)).toEqual([]);
    });
  });
});
