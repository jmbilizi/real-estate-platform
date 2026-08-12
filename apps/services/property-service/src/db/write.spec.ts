import { readFileSync } from 'fs';
import { join } from 'path';
import { applyTerminalCorrection, Queryable } from './write';

/**
 * Guards on the terminal-correction escape hatch.
 *
 * `applyTerminalCorrection` is the only sanctioned way to change a frozen listing, which makes it the
 * one place where the module's containment can be talked out of. Both guards are asserted here
 * because neither can be expressed in the database: the terminal check is a precondition rather than
 * a constraint, and the column allowlist protects an identifier that cannot be bound as a parameter.
 */
interface RecordedQuery {
  text: string;
  values?: unknown[];
}

function createFakeClient(statusRows: Record<string, unknown>[]): {
  client: Queryable;
  queries: RecordedQuery[];
} {
  const queries: RecordedQuery[] = [];
  const client: Queryable = {
    query: (text: string, values?: unknown[]) => {
      queries.push({ text, values });
      if (text.includes('is_terminal')) {
        return Promise.resolve({ rows: statusRows });
      }
      return Promise.resolve({ rows: [] });
    },
  };
  return { client, queries };
}

const baseInput = {
  listingId: 'listing-1',
  propertyId: 'property-1',
  reason: 'MLS corrected the advertised area',
  actor: 'ops@cribstop.com',
};

describe('applyTerminalCorrection', () => {
  it('applies the correction and appends an audit event for a terminal listing', async () => {
    const { client, queries } = createFakeClient([{ is_terminal: true }]);

    await applyTerminalCorrection(client, { ...baseInput, columns: { living_sqft: 1850 } });

    const update = queries.find((q) => q.text.includes('UPDATE listings'));
    expect(update).toBeDefined();
    expect(update?.text).toContain('living_sqft = $2');
    expect(update?.values).toEqual(['listing-1', 1850]);
    // The correction is only legitimate because it is audited; a silent UPDATE is the failure mode.
    expect(queries.some((q) => q.text.includes('INSERT INTO listing_events'))).toBe(true);
  });

  it('refuses a listing that is not terminal, and writes nothing', async () => {
    const { client, queries } = createFakeClient([{ is_terminal: false }]);

    await expect(
      applyTerminalCorrection(client, { ...baseInput, columns: { living_sqft: 1850 } }),
    ).rejects.toThrow(/not in a terminal status/);

    expect(queries.some((q) => q.text.includes('UPDATE listings'))).toBe(false);
    expect(queries.some((q) => q.text.includes('INSERT INTO listing_events'))).toBe(false);
  });

  it('refuses a listing that does not exist', async () => {
    const { client, queries } = createFakeClient([]);

    await expect(
      applyTerminalCorrection(client, { ...baseInput, columns: { beds: 4 } }),
    ).rejects.toThrow(/does not exist/);

    expect(queries.some((q) => q.text.includes('UPDATE listings'))).toBe(false);
  });

  it('refuses a column outside the allowlist before issuing any query', async () => {
    const { client, queries } = createFakeClient([{ is_terminal: true }]);

    await expect(
      applyTerminalCorrection(client, {
        ...baseInput,
        // The cast is the point: the compiler stops honest callers, so the runtime guard is what
        // stands between an unvalidated payload and an arbitrary identifier interpolated into SQL.
        columns: { address_display_allowed: false } as never,
      }),
    ).rejects.toThrow(/cannot change: address_display_allowed/);

    expect(queries).toHaveLength(0);
  });

  it('requires at least one column to change', async () => {
    const { client, queries } = createFakeClient([{ is_terminal: true }]);

    await expect(applyTerminalCorrection(client, { ...baseInput, columns: {} })).rejects.toThrow(
      /at least one column/,
    );

    expect(queries).toHaveLength(0);
  });
});

/**
 * The two RESO seller display-suppression flags and the description moderation state were absent from
 * `upsertListing`'s column list until #22, so every written row silently took the database defaults
 * (`true`, `true`, `'approved'`). The consequence of a regression here is not a broken test — it is
 * publishing a listing, or an address, that a seller withheld. So the binding is asserted directly,
 * against the parameter array rather than the SQL text, because a column can be present in the
 * statement and still be handed the wrong value.
 */
describe('upsertListing column coverage for the suppression flags', () => {
  const insertColumns = (): string => {
    // Read from the module's own SQL rather than restating a field list, so this test cannot pass by
    // agreeing with a copy of the truth.
    const source = readFileSync(join(__dirname, 'write.ts'), 'utf8');
    const start = source.indexOf('INSERT INTO listings');
    expect(start).toBeGreaterThan(-1);
    return source.slice(start, source.indexOf('VALUES', start));
  };

  it.each([
    'internet_display_allowed',
    'address_display_allowed',
    'description_moderation',
    'featured_reason',
  ])('names %s in the INSERT, so the caller-supplied value is not lost to a default', (column) => {
    expect(insertColumns()).toContain(column);
  });

  it('binds one parameter per column, so no value is shifted out of step with its column', () => {
    const source = readFileSync(join(__dirname, 'write.ts'), 'utf8');
    const start = source.indexOf('INSERT INTO listings');
    const statementEnd = source.indexOf('`,', start);
    const statement = source.slice(start, statementEnd);

    const columnList = statement.slice(statement.indexOf('(') + 1, statement.indexOf('VALUES'));
    const columnCount = columnList.split(',').filter((entry) => entry.trim().length > 0).length;
    const placeholderCount = new Set(statement.slice(statement.indexOf('VALUES')).match(/\$\d+/g))
      .size;

    // A literal such as now() inside the VALUES list consumes no placeholder and silently shifts
    // every later column onto the wrong value — the exact trap this project's CLAUDE.md warns about.
    expect(placeholderCount).toBe(columnCount);
  });
});
