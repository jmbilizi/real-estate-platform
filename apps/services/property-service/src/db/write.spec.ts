import { readFileSync } from 'fs';
import { join } from 'path';
import {
  applyTerminalCorrection,
  insertMedia,
  Queryable,
  softDeleteListings,
  upsertListingBySourceKey,
} from './write';
import { ListingRow } from '../seed/types';

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
    // #53. Same failure mode as the four above: a caller-suppressed field silently taking the
    // permissive database default is a compliance disclosure, not a cosmetic bug.
    'price_display_allowed',
    'price_history_display_allowed',
    'media_display_allowed',
    'days_on_market_display_allowed',
    'days_on_market',
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
    // every later column onto the wrong value — the exact trap this project's AGENTS.md warns about.
    expect(placeholderCount).toBe(columnCount);
  });
});

describe('insertMedia carries alt_text (#105)', () => {
  it('binds the caller-supplied alt_text, so a feed-authored photo caption cannot be silently lost', async () => {
    // The column is nullable with no constraint, so before #105 every row was NULL by accident
    // rather than by decision — which made the address suppression over it untestable, i.e. a test
    // that could not fail. MLS captions read exactly like the value below.
    const { client, queries } = createFakeClient([]);

    await insertMedia(client, [
      {
        id: 'media-1',
        listing_id: 'listing-1',
        source_url: 'https://cdn.example/photo-1.jpg',
        alt_text: 'Front elevation of 142 Oak St',
        sort_order: 0,
        is_primary: true,
        retained_when_suppressed: false,
        is_sample: true,
      },
    ]);

    const [recorded] = queries;
    expect(recorded?.text).toContain('alt_text');
    expect(recorded?.values).toEqual([
      'media-1',
      'listing-1',
      'https://cdn.example/photo-1.jpg',
      'Front elevation of 142 Oak St',
      0,
      true,
      false,
      true,
    ]);
  });

  it('binds one parameter per column, so no value is shifted out of step with its column', () => {
    const source = readFileSync(join(__dirname, 'write.ts'), 'utf8');
    const start = source.indexOf('INSERT INTO listing_media');
    expect(start).toBeGreaterThan(-1);
    const statement = source.slice(start, source.indexOf('`,', start));

    const columnList = statement.slice(statement.indexOf('(') + 1, statement.indexOf('VALUES'));
    const columnCount = columnList.split(',').filter((entry) => entry.trim().length > 0).length;
    const placeholderCount = new Set(statement.slice(statement.indexOf('VALUES')).match(/\$\d+/g))
      .size;

    expect(placeholderCount).toBe(columnCount);
  });
});

/**
 * Idempotent re-ingest keyed on the feed's own identity (#93). A Bright pass is re-run from
 * staging whenever a mapping bug is fixed, so re-processing the same `ListingKey` must land on the
 * SAME `properties`/`listings` rows, never mint a second copy.
 */
describe('upsertListingBySourceKey', () => {
  const baseRow: Omit<ListingRow, 'id'> & { source_system: string; source_listing_key: string } = {
    property_id: 'property-1',
    unit_id: null,
    title: 'Single Family in Arlington, VA',
    offer_kind: 'sale',
    consumer_status: 'Active',
    status: 'Active',
    source: 'brightMLS',
    source_system: 'BrightMLS',
    source_listing_key: 'BR-1',
    source_listing_id: 'MLS123',
    source_modification_timestamp: '2026-09-18T00:00:00Z',
    list_price: 500000,
    close_price: null,
    close_date: null,
    beds: null,
    baths_full: null,
    baths_half: null,
    living_sqft: null,
    lot_sqft: null,
    year_built: null,
    neighborhood: null,
    city: 'Arlington',
    state: 'VA',
    zip5: '22201',
    latitude: null,
    longitude: null,
    description: null,
    description_source: null,
    amenities: [],
    description_moderation: 'approved',
    featured: false,
    featured_reason: null,
    price_reduced: false,
    new_construction: false,
    internet_display_allowed: true,
    address_display_allowed: true,
    price_display_allowed: false,
    price_history_display_allowed: false,
    media_display_allowed: false,
    days_on_market_display_allowed: false,
    days_on_market: null,
    broker_name: 'Acme Realty',
    broker_phone: '2025551234',
    broker_email: 'office@acme.example',
    office_name: 'Acme Realty',
    office_broker_lead_phone: null,
    office_broker_lead_email: null,
    listing_agent_name: null,
    is_sample: true,
    last_updated: '2026-09-18T00:00:00Z',
  };

  function createFakeClient(options: {
    lookupRows: Record<string, unknown>[];
    factsRows?: Record<string, unknown>[];
  }): { client: Queryable; queries: RecordedQuery[] } {
    const queries: RecordedQuery[] = [];
    const client: Queryable = {
      query: (text: string, values?: unknown[]) => {
        queries.push({ text, values });
        if (text.includes('l.source_system')) {
          return Promise.resolve({ rows: options.lookupRows });
        }
        if (text.includes('is_terminal') && text.includes('l.id = $1')) {
          // assertNotTerminal, called from upsertListing itself.
          return Promise.resolve({
            rows: options.lookupRows.length > 0 ? [{ is_terminal: false }] : [],
          });
        }
        if (text.includes('FROM properties p')) {
          return Promise.resolve({
            rows: options.factsRows ?? [
              {
                beds: 3,
                baths_full: 2,
                baths_half: 0,
                living_sqft: 1500,
                lot_sqft: 4000,
                year_built: 1990,
                neighborhood: null,
                city: 'Arlington',
                state: 'VA',
                zip5: '22201',
                latitude: null,
                longitude: null,
                is_sample: true,
              },
            ],
          });
        }
        return Promise.resolve({ rows: [] });
      },
    };
    return { client, queries };
  }

  it('inserts a new listing with a fresh id when no match exists', async () => {
    const { client, queries } = createFakeClient({ lookupRows: [] });

    const id = await upsertListingBySourceKey(client, baseRow);

    expect(typeof id).toBe('string');
    const insert = queries.find((q) => q.text.includes('INSERT INTO listings'));
    expect(insert?.values?.[0]).toBe(id);
    expect(insert?.values?.[8]).toBe('BrightMLS');
    expect(insert?.values?.[9]).toBe('BR-1');
  });

  it('reuses the existing id and updates in place on a second pass', async () => {
    const { client, queries } = createFakeClient({
      lookupRows: [{ id: 'listing-1', is_terminal: false }],
    });

    const id = await upsertListingBySourceKey(client, baseRow);

    expect(id).toBe('listing-1');
    const insert = queries.find((q) => q.text.includes('INSERT INTO listings'));
    expect(insert?.text).toContain('ON CONFLICT (id) DO UPDATE');
    expect(insert?.values?.[0]).toBe('listing-1');
  });

  it('leaves a terminal match untouched instead of re-snapshotting it', async () => {
    const { client, queries } = createFakeClient({
      lookupRows: [{ id: 'listing-1', is_terminal: true }],
    });

    const id = await upsertListingBySourceKey(client, baseRow);

    expect(id).toBe('listing-1');
    expect(queries.some((q) => q.text.includes('INSERT INTO listings'))).toBe(false);
  });
});

/**
 * The daily key reconciliation's write (#331): a listing absent from Bright's live key set is
 * soft-deleted, never hard-deleted, and the takedown is audited the same way every other listing
 * write is.
 */
describe('softDeleteListings', () => {
  function fakeClient(returnedRows: Record<string, unknown>[]): {
    client: Queryable;
    queries: RecordedQuery[];
  } {
    const queries: RecordedQuery[] = [];
    const client: Queryable = {
      query: (text: string, values?: unknown[]) => {
        queries.push({ text, values });
        if (text.includes('UPDATE listings')) {
          return Promise.resolve({ rows: returnedRows });
        }
        return Promise.resolve({ rows: [] });
      },
    };
    return { client, queries };
  }

  it('soft-deletes only the listings the UPDATE actually touched, and audits each one', async () => {
    const { client, queries } = fakeClient([{ id: 'listing-1', property_id: 'property-1' }]);

    const deleted = await softDeleteListings(client, ['listing-1', 'listing-2'], 'reconciliation');

    expect(deleted).toBe(1);
    const update = queries.find((q) => q.text.includes('UPDATE listings'));
    expect(update?.text).toContain('deleted_at = now()');
    expect(update?.text).toContain('deleted_at IS NULL');
    expect(update?.values).toEqual([['listing-1', 'listing-2']]);
    const event = queries.find((q) => q.text.includes('INSERT INTO listing_events'));
    expect(event?.values).toEqual(
      expect.arrayContaining(['listing-1', 'property-1', 'withdrawn', 'reconciliation']),
    );
  });

  it('does nothing and issues no query for an empty list', async () => {
    const { client, queries } = fakeClient([]);
    expect(await softDeleteListings(client, [], 'reconciliation')).toBe(0);
    expect(queries).toEqual([]);
  });
});
