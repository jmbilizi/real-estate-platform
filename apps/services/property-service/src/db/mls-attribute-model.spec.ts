import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { LISTING_CARD_COLUMNS, LISTING_DETAIL_SELECT } from '../listings/columns';

/**
 * Structural guards on the MLS attribute model, asserted against the DDL the migration actually emits.
 *
 * WHY IT EXECUTES THE MIGRATION RATHER THAN GREPPING IT. `down()` drops the same tables the header
 * forbids adding a text column to, and a future migration that ALTERs these tables will carry both
 * directions in one file. Grepping the file text reads both and cannot tell them apart; running `up()`
 * against a recording `pgm` captures exactly what will reach Postgres. This mirrors
 * `listing-search-view.spec.ts`, which exists for the same reason.
 *
 * WHY IT SCANS EVERY MIGRATION, NOT JUST THIS ONE. Migration files are immutable once merged, so the
 * model is extended by APPENDING. A guard pinned to one filename would keep passing while a later
 * migration added the very column this file forbids — which is the exact silent failure the
 * immutability rule creates.
 */

interface RecordedColumn {
  type?: string;
  check?: string;
  [key: string]: unknown;
}

interface Recording {
  /** Every column ever created on an attribute table, as `table.column` → definition. */
  columns: Map<string, RecordedColumn>;
  /** Table name → the set of constraint definitions added to it. */
  constraints: { table: string; name: string; definition: Record<string, unknown> }[];
  indexes: { table: string; columns: unknown; options: Record<string, unknown> }[];
  sql: string[];
  views: string[];
}

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');
const ATTRIBUTE_TABLES = ['listing_attributes', 'property_attributes'];
const REGISTRY_TABLES = ['mls_fields', 'mls_lookup_values'];
const MODEL_TABLES = [...REGISTRY_TABLES, ...ATTRIBUTE_TABLES];

/** Runs `up()` of the given migrations against a recording builder and returns what they emitted. */
function recordMigrations(files: string[]): Recording {
  const requireMigration = createRequire(__filename);
  const recording: Recording = {
    columns: new Map(),
    constraints: [],
    indexes: [],
    sql: [],
    views: [],
  };

  const builder = {
    createTable: (table: string, columns: Record<string, RecordedColumn>) => {
      for (const [column, definition] of Object.entries(columns)) {
        recording.columns.set(`${table}.${column}`, definition);
      }
    },
    addColumns: (table: string, columns: Record<string, RecordedColumn>) => {
      for (const [column, definition] of Object.entries(columns)) {
        recording.columns.set(`${table}.${column}`, definition);
      }
    },
    addConstraint: (table: string, name: string, definition: Record<string, unknown>) => {
      recording.constraints.push({ table, name, definition });
    },
    createIndex: (table: string, columns: unknown, options: Record<string, unknown> = {}) => {
      recording.indexes.push({ table, columns, options });
    },
    sql: (statement: string) => recording.sql.push(statement),
    createView: (name: string) => recording.views.push(name),
    func: (expression: string) => expression,
    alterColumn: (table: string, column: string, definition: RecordedColumn) => {
      recording.columns.set(`${table}.${column}`, definition);
    },
  };

  /**
   * Anything this recorder does not explicitly model is a harmless no-op.
   *
   * A fixed method list would turn "a future migration used a builder method nobody anticipated" into
   * a failure of THIS guard, which reports the wrong problem and tempts the next person to delete the
   * guard rather than the obstacle. The methods that matter are recorded above; everything else
   * (extensions, triggers, drops) has no bearing on whether a text value column exists.
   */
  const recordingBuilder = new Proxy(builder as Record<string, unknown>, {
    get: (target, property) => (property in target ? target[property as string] : () => undefined),
  });

  for (const file of files) {
    const migration = requireMigration(join(MIGRATIONS_DIR, file)) as {
      up?: (pgm: unknown) => void;
    };
    // A view migration's `up()` is pure `pgm.sql`, which this builder records harmlessly.
    migration.up?.(recordingBuilder);
  }

  return recording;
}

/** Every migration, in the order `checkOrder` guarantees Postgres will apply them. */
const ALL_MIGRATIONS = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith('.js'))
  .sort();

const recording = recordMigrations(ALL_MIGRATIONS);

/** What ONE migration emits, for the assertions that are about this change rather than the schema. */
const recordOne = (file: string): Recording => recordMigrations([file]);

const columnsOf = (table: string): [string, RecordedColumn][] =>
  [...recording.columns.entries()]
    .filter(([key]) => key.startsWith(`${table}.`))
    .map(([key, definition]) => [key.slice(table.length + 1), definition]);

describe('the Fair Housing guarantee: free text is unrepresentable on the attribute path', () => {
  it.each(ATTRIBUTE_TABLES)('%s stores values ONLY in the five typed columns', (table) => {
    // Asserted as an exact set rather than by scanning for text types, because `value_kind` is a text
    // column on these tables and is NOT a value — it is the discriminator naming which of the five
    // below is populated. A pattern match would either flag it forever or be loosened until it
    // stopped catching the thing that matters.
    const valueColumns = columnsOf(table)
      .map(([column]) => column)
      .filter((column) => column.startsWith('value_') && column !== 'value_kind')
      .sort();

    // If this fails because a column was ADDED, do not relax it. An open text value column is the
    // `keywords`/`tags`/`features` bag that `listings` deliberately does not have, reintroduced one
    // table over — it would accept "quiet, safe block, great for families" with no review.
    expect(valueColumns).toEqual([
      'value_boolean',
      'value_date',
      'value_lookup_id',
      'value_numeric',
      'value_timestamp',
    ]);
  });

  it.each(ATTRIBUTE_TABLES)('%s types none of those five as text', (table) => {
    const textTyped = columnsOf(table).filter(
      ([column, definition]) =>
        column.startsWith('value_') &&
        column !== 'value_kind' &&
        /text|varchar|char|citext|json/i.test(String(definition.type)),
    );
    expect(textTyped).toEqual([]);
  });

  it.each(ATTRIBUTE_TABLES)('%s has no jsonb bag either', (table) => {
    const bags = columnsOf(table).filter(([, definition]) => /json/i.test(String(definition.type)));
    expect(bags).toEqual([]);
  });

  it('registers no data type that would need a text column to store', () => {
    const dataType = recording.columns.get('mls_fields.data_type');
    expect(dataType?.check).toBeDefined();
    // Adding 'string'/'text' to this CHECK is how the guarantee would be lost, so the vocabulary is
    // asserted exactly rather than by absence.
    expect(dataType?.check).toBe(
      "data_type IN ('integer','decimal','boolean','date','timestamp','lookup')",
    );
  });

  it.each(ATTRIBUTE_TABLES)('%s constrains exactly one typed value per row', (table) => {
    const shape = recording.constraints.find((c) => c.name === `${table}_value_shape`);
    expect(String(shape?.definition.check)).toContain('num_nonnulls');
  });
});

describe('governance is enforced by the database, not by the writer alone', () => {
  it.each(ATTRIBUTE_TABLES)('%s ties a lookup value to the field it belongs to', (table) => {
    const fk = recording.constraints.find((c) => c.name === `${table}_lookup_value_fk`);
    const foreignKeys = fk?.definition.foreignKeys as { columns: string[]; references: string };

    // The composite half is what stops one system's value being attached to another system's field.
    expect(foreignKeys.columns).toEqual(['field_id', 'value_lookup_id']);
    expect(foreignKeys.references).toBe('mls_lookup_values (field_id, id)');
  });

  it.each(ATTRIBUTE_TABLES)("%s ties the value column to the field's registered type", (table) => {
    const fk = recording.constraints.find((c) => c.name === `${table}_field_data_type_fk`);
    const foreignKeys = fk?.definition.foreignKeys as { columns: string[]; references: string };
    expect(foreignKeys.columns).toEqual(['field_id', 'value_kind']);
    expect(foreignKeys.references).toBe('mls_fields (id, data_type)');
  });

  it.each(ATTRIBUTE_TABLES)("%s ties the table to the field's registered scope", (table) => {
    const fk = recording.constraints.find((c) => c.name === `${table}_field_scope_fk`);
    const foreignKeys = fk?.definition.foreignKeys as { columns: string[]; references: string };
    expect(foreignKeys.columns).toEqual(['field_id', 'field_scope']);
    expect(foreignKeys.references).toBe('mls_fields (id, scope)');
  });

  it('defaults a newly registered field to address-bearing and not consumer-displayable', () => {
    // Default-DENY on both axes (#53): the failure mode being closed is a field nobody classified
    // becoming visible, which is how a column-by-column suppression rule fails open.
    expect(recording.columns.get('mls_fields.is_address_bearing')?.default).toBe(true);
    expect(recording.columns.get('mls_fields.is_consumer_displayable')?.default).toBe(false);
  });

  it('forbids an address-bearing field from being consumer-displayable at all', () => {
    const constraint = recording.constraints.find(
      (c) => c.name === 'mls_fields_address_bearing_not_displayable',
    );
    expect(constraint?.definition.check).toBe(
      'NOT (is_address_bearing AND is_consumer_displayable)',
    );
  });
});

describe('indexes cover the two stated access patterns', () => {
  it.each(ATTRIBUTE_TABLES)('%s indexes every attribute of one entity', (table) => {
    const owner = table === 'listing_attributes' ? 'listing_id' : 'property_id';
    const index = recording.indexes.find(
      (i) => i.options.name === `idx_${table}_owner_field_value`,
    );
    expect(index?.columns).toEqual([owner, 'field_id', 'value_lookup_id']);
    // NULLS NOT DISTINCT is what makes a scalar field single-valued and a lookup field multi-valued
    // without a flag to keep in sync — and what makes a repeated feed value idempotent.
    expect(index?.options.unique).toBe(true);
    expect(index?.options.nulls).toBe('not distinct');
  });

  it.each(ATTRIBUTE_TABLES)('%s indexes the reverse lookup, entities having a value', (table) => {
    const names = recording.indexes.map((i) => i.options.name);
    expect(names).toContain(`idx_${table}_field_lookup`);
    expect(names).toContain(`idx_${table}_field_numeric`);
  });
});

describe('the registry is market-agnostic', () => {
  it('scopes a field to its originating system as part of its identity', () => {
    const unique = recording.constraints.find((c) => c.name === 'mls_fields_identity_unique');
    expect(unique?.definition.unique).toEqual([
      'originating_system',
      'reso_resource',
      'field_name',
    ]);
  });

  it('names no MLS anywhere in the migration, and seeds no vocabulary', () => {
    const source = readFileSync(
      join(MIGRATIONS_DIR, '1785801600013_create-mls-attribute-registry.js'),
      'utf8',
    );
    // Bright is named in prose (it is the motivating feed), but never as a value the schema depends
    // on: no INSERT seeds a field or a value, because the vocabulary arrives from `$metadata` (#91).
    expect(source).not.toMatch(/INSERT\s+INTO\s+mls_/i);
    expect(recordOne('1785801600013_create-mls-attribute-registry.js').sql).toEqual([]);
  });
});

describe('nothing is exposed to a consumer by this change', () => {
  it('emits no DDL touching listing_search_v', () => {
    // Asserted against what the migration EMITS, not its file text — the header discusses the view at
    // length (deliberately: the next person needs to know why attributes are not in it), and a
    // text-level check would fail on the explanation rather than on a change.
    const emitted = recordOne('1785801600013_create-mls-attribute-registry.js');
    expect(emitted.sql).toEqual([]);
    expect(emitted.views).toEqual([]);
  });

  it.each(MODEL_TABLES)('does not project %s into any read model', (table) => {
    // The read projections are the only route to a consumer. Until the exposure sibling lands, an
    // attribute is unreachable from the API by construction rather than by nobody having asked.
    expect(LISTING_CARD_COLUMNS.some((column) => column.includes(table))).toBe(false);
    expect(LISTING_DETAIL_SELECT).not.toContain(table);
  });

  it.each(['attribute', 'mls_field', 'lookup_value'])(
    'exports no %s shape from the wire contract',
    (term) => {
      const contract = readFileSync(
        join(
          __dirname,
          '..',
          '..',
          '..',
          '..',
          '..',
          'libs',
          'property-contracts',
          'src',
          'index.ts',
        ),
        'utf8',
      );
      expect(contract.toLowerCase()).not.toContain(term);
    },
  );
});

describe('the existing closed sets are untouched', () => {
  it.each([
    ['listings.amenities', 'amenities'],
    ['properties.property_type', 'property_type'],
  ])('leaves %s with its CHECK constraint', (key) => {
    const column = recording.columns.get(key);
    // This ticket deliberately does NOT migrate these onto the attribute store. If a later ticket
    // converges them, it removes this assertion on purpose — it must not lapse by accident.
    expect(column?.check).toBeDefined();
  });
});
