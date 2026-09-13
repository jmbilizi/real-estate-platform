import {
  MlsAttributeInput,
  putListingAttributes,
  putPropertyAttributes,
  registerMlsField,
  registerMlsLookupValue,
} from './mls-attributes';
import { Queryable } from './write';

/**
 * Behavioural guards on the governed attribute writer.
 *
 * The DATABASE is the thing that actually makes an unregistered field or value unstorable — migration
 * `1785801600013` does it with composite foreign keys, and a structural guard over that migration lives
 * in `mls-attribute-model.spec.ts`. What is asserted HERE is the half the database cannot express:
 * that this module detects a rejection FIRST and reports it, instead of letting a constraint violation
 * abort the surrounding ingest transaction, and that a rejected field leaves its previously stored
 * values alone rather than half-applying a set.
 */

interface RecordedQuery {
  text: string;
  values?: unknown[];
}

interface FakeRows {
  /** Rows returned for the `mls_fields` lookup, keyed by field name. */
  fields?: Record<string, Record<string, unknown>>;
  /** Rows returned for the `mls_lookup_values` lookup, keyed by the raw feed value. */
  lookupValues?: Record<string, Record<string, unknown>>;
  /** Rows the reconciling DELETE claims to have removed. */
  deleted?: Record<string, unknown>[];
}

function createFakeClient(data: FakeRows): { client: Queryable; queries: RecordedQuery[] } {
  const queries: RecordedQuery[] = [];
  const client: Queryable = {
    query: (text: string, values?: unknown[]) => {
      queries.push({ text, values });
      if (text.includes('FROM mls_fields')) {
        const fieldName = String(values?.[2]);
        const row = data.fields?.[fieldName];
        return Promise.resolve({ rows: row ? [row] : [] });
      }
      if (text.includes('FROM mls_lookup_values')) {
        const value = String(values?.[1]);
        const row = data.lookupValues?.[value];
        return Promise.resolve({ rows: row ? [row] : [] });
      }
      if (text.includes('DELETE FROM')) {
        return Promise.resolve({ rows: data.deleted ?? [] });
      }
      if (text.includes('RETURNING id')) {
        return Promise.resolve({ rows: [{ id: 'generated-id' }] });
      }
      return Promise.resolve({ rows: [] });
    },
  };
  return { client, queries };
}

const BRIGHT_KEY = {
  originatingSystem: 'testMLS',
  resoResource: 'Property',
  fieldName: 'LotSizeAcres',
};

const numericField = {
  id: 'field-1',
  data_type: 'decimal',
  scope: 'listing',
  retired_at: null,
};

const lookupField = {
  id: 'field-2',
  data_type: 'lookup',
  scope: 'listing',
  retired_at: null,
};

const inserts = (queries: RecordedQuery[], table: string): RecordedQuery[] =>
  queries.filter((q) => q.text.includes(`INSERT INTO ${table}`));

describe('putListingAttributes — fail closed without aborting the batch', () => {
  it('rejects an unregistered field, stores nothing for it, and writes no attribute row', async () => {
    const { client, queries } = createFakeClient({ fields: {} });

    const result = await putListingAttributes(client, 'listing-1', [
      { ...BRIGHT_KEY, value: 0.34 },
    ]);

    expect(result.stored).toBe(0);
    expect(result.rejected).toEqual([
      { ...BRIGHT_KEY, reason: 'unregistered_field', value: '0.34' },
    ]);
    // The point of the whole design: the caller gets a record, not an exception, and the transaction
    // it is running inside is still usable for the other 200 fields in the payload.
    expect(inserts(queries, 'listing_attributes')).toHaveLength(0);
  });

  it('rejects an unregistered lookup VALUE — adding one must be an INSERT, never a silent store', async () => {
    const { client, queries } = createFakeClient({
      fields: { ArchitecturalStyle: lookupField },
      lookupValues: {},
    });

    const result = await putListingAttributes(client, 'listing-1', [
      { ...BRIGHT_KEY, fieldName: 'ArchitecturalStyle', value: 'Colonial' },
    ]);

    expect(result.rejected[0]?.reason).toBe('unregistered_value');
    expect(result.rejected[0]?.value).toBe('Colonial');
    expect(inserts(queries, 'listing_attributes')).toHaveLength(0);
  });

  it('leaves the previously stored set ALONE when one value of a field is unregistered', async () => {
    // The data-loss trap this guards: reconciling the set anyway would delete two good, reviewed
    // values because a THIRD one is new. A stale set beats a destroyed one.
    const { client, queries } = createFakeClient({
      fields: { ArchitecturalStyle: lookupField },
      lookupValues: { Colonial: { id: 'value-1', retired_at: null } },
    });

    const result = await putListingAttributes(client, 'listing-1', [
      { ...BRIGHT_KEY, fieldName: 'ArchitecturalStyle', value: ['Colonial', 'Brutalist'] },
    ]);

    expect(result.rejected[0]?.reason).toBe('unregistered_value');
    expect(result.stored).toBe(0);
    expect(queries.some((q) => q.text.includes('DELETE FROM listing_attributes'))).toBe(false);
    expect(inserts(queries, 'listing_attributes')).toHaveLength(0);
  });

  it('rejects a retired value rather than storing against a withdrawn vocabulary entry', async () => {
    const { client } = createFakeClient({
      fields: { ArchitecturalStyle: lookupField },
      lookupValues: { Colonial: { id: 'value-1', retired_at: '2026-01-01T00:00:00.000Z' } },
    });

    const result = await putListingAttributes(client, 'listing-1', [
      { ...BRIGHT_KEY, fieldName: 'ArchitecturalStyle', value: 'Colonial' },
    ]);

    expect(result.rejected[0]?.reason).toBe('retired_value');
  });

  it('rejects a field whose registered scope belongs to the other table', async () => {
    const { client, queries } = createFakeClient({
      fields: { LotSizeAcres: { ...numericField, scope: 'property' } },
    });

    const result = await putListingAttributes(client, 'listing-1', [
      { ...BRIGHT_KEY, value: 0.34 },
    ]);

    expect(result.rejected[0]?.reason).toBe('wrong_scope');
    expect(inserts(queries, 'listing_attributes')).toHaveLength(0);
  });

  it('truncates a long rejected value, so a marketing remark cannot ride out inside a diagnostic', async () => {
    const { client } = createFakeClient({ fields: {} });
    const prose = 'quiet safe block, great for families, top schools, '.repeat(10);

    const result = await putListingAttributes(client, 'listing-1', [
      { ...BRIGHT_KEY, value: prose },
    ]);

    expect(result.rejected[0]?.value?.length).toBeLessThanOrEqual(121);
    expect(result.rejected[0]?.value).not.toBe(prose);
  });
});

describe('putListingAttributes — typed storage', () => {
  it('binds a decimal to value_numeric and leaves every other typed column null', async () => {
    const { client, queries } = createFakeClient({ fields: { LotSizeAcres: numericField } });

    const result = await putListingAttributes(client, 'listing-1', [
      { ...BRIGHT_KEY, value: 0.34 },
    ]);

    expect(result.stored).toBe(1);
    const insert = inserts(queries, 'listing_attributes')[0];
    // Column order in the INSERT: owner, field_id, field_scope, value_kind, numeric, boolean, date,
    // timestamp, lookup, source_modification_timestamp.
    expect(insert?.values).toEqual([
      'listing-1',
      'field-1',
      'listing',
      'decimal',
      0.34,
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it('accepts a numeric STRING, because RESO serialises Edm.Decimal that way over JSON', async () => {
    const { client, queries } = createFakeClient({ fields: { LotSizeAcres: numericField } });

    await putListingAttributes(client, 'listing-1', [{ ...BRIGHT_KEY, value: '0.34' }]);

    expect(inserts(queries, 'listing_attributes')[0]?.values?.[4]).toBe(0.34);
  });

  it.each<[unknown, string]>([
    ['not-a-number', 'a non-numeric string never becomes NaN or 0'],
    [{ nested: true }, 'an object is not silently JSON-stringified into a value'],
    [true, 'a boolean is not coerced to 1'],
  ])('rejects %p as a type mismatch — %s', async (value: unknown) => {
    const { client, queries } = createFakeClient({ fields: { LotSizeAcres: numericField } });

    const result = await putListingAttributes(client, 'listing-1', [{ ...BRIGHT_KEY, value }]);

    expect(result.rejected[0]?.reason).toBe('type_mismatch');
    expect(inserts(queries, 'listing_attributes')).toHaveLength(0);
  });

  it('rejects a fractional value for a field registered as an integer', async () => {
    const { client } = createFakeClient({
      fields: { LotSizeAcres: { ...numericField, data_type: 'integer' } },
    });

    const result = await putListingAttributes(client, 'listing-1', [{ ...BRIGHT_KEY, value: 3.5 }]);

    expect(result.rejected[0]?.reason).toBe('type_mismatch');
  });

  it("does not coerce 'Y' into a boolean — a feed spelling booleans that way needs a reviewed mapping", async () => {
    const { client } = createFakeClient({
      fields: { LotSizeAcres: { ...numericField, data_type: 'boolean' } },
    });

    const result = await putListingAttributes(client, 'listing-1', [{ ...BRIGHT_KEY, value: 'Y' }]);

    expect(result.rejected[0]?.reason).toBe('type_mismatch');
  });

  it('writes one row per value of a multi-valued lookup field', async () => {
    const { client, queries } = createFakeClient({
      fields: { ArchitecturalStyle: lookupField },
      lookupValues: {
        Colonial: { id: 'value-1', retired_at: null },
        Craftsman: { id: 'value-2', retired_at: null },
      },
    });

    const result = await putListingAttributes(client, 'listing-1', [
      { ...BRIGHT_KEY, fieldName: 'ArchitecturalStyle', value: ['Colonial', 'Craftsman'] },
    ]);

    expect(result.stored).toBe(2);
    const written = inserts(queries, 'listing_attributes');
    expect(written.map((q) => q.values?.[8])).toEqual(['value-1', 'value-2']);
    // The lookup rows carry no scalar value at all — this is the Fair Housing guarantee in practice.
    expect(written.every((q) => q.values?.[4] === null)).toBe(true);
  });
});

describe('putListingAttributes — reconciling a set the feed has changed', () => {
  it('removes the values the feed stopped sending, keeping the ones it still sends', async () => {
    const { client, queries } = createFakeClient({
      fields: { ArchitecturalStyle: lookupField },
      lookupValues: { Colonial: { id: 'value-1', retired_at: null } },
      deleted: [{ id: 'stale-row' }],
    });

    const result = await putListingAttributes(client, 'listing-1', [
      { ...BRIGHT_KEY, fieldName: 'ArchitecturalStyle', value: 'Colonial' },
    ]);

    const remove = queries.find((q) => q.text.includes('DELETE FROM listing_attributes'));
    expect(remove?.values).toEqual(['listing-1', 'field-2', ['value-1'], false]);
    expect(result.removed).toBe(1);
  });

  it('clears a field entirely when the feed sends null for it', async () => {
    // An upsert cannot express a withdrawn value, so this is the ONLY path by which a value that the
    // MLS has removed ever leaves the store.
    const { client, queries } = createFakeClient({
      fields: { LotSizeAcres: numericField },
      deleted: [{ id: 'stale-row' }],
    });

    const result = await putListingAttributes(client, 'listing-1', [
      { ...BRIGHT_KEY, value: null },
    ]);

    expect(inserts(queries, 'listing_attributes')).toHaveLength(0);
    const remove = queries.find((q) => q.text.includes('DELETE FROM listing_attributes'));
    // Neither arm of the CASE is satisfied by a kept value, so both the scalar row and any lookup
    // rows are removed.
    expect(remove?.values).toEqual(['listing-1', 'field-1', [], false]);
    expect(result.removed).toBe(1);
  });

  it('keeps the scalar row it just wrote, rather than deleting it in the same call', async () => {
    const { client, queries } = createFakeClient({ fields: { LotSizeAcres: numericField } });

    await putListingAttributes(client, 'listing-1', [{ ...BRIGHT_KEY, value: 0.34 }]);

    const remove = queries.find((q) => q.text.includes('DELETE FROM listing_attributes'));
    // `keptScalar = true` is what spares the row the INSERT above just created.
    expect(remove?.values?.[3]).toBe(true);
  });

  it('never touches a field the payload did not mention', async () => {
    const { client, queries } = createFakeClient({ fields: { LotSizeAcres: numericField } });

    await putListingAttributes(client, 'listing-1', [{ ...BRIGHT_KEY, value: 0.34 }]);

    const removes = queries.filter((q) => q.text.includes('DELETE FROM listing_attributes'));
    expect(removes).toHaveLength(1);
    expect(removes[0]?.values?.[1]).toBe('field-1');
  });
});

describe('putPropertyAttributes', () => {
  it('writes to property_attributes with the property scope pinned', async () => {
    const { client, queries } = createFakeClient({
      fields: { LotSizeAcres: { ...numericField, scope: 'property' } },
    });

    const result = await putPropertyAttributes(client, 'property-1', [
      { ...BRIGHT_KEY, value: 0.34 },
    ]);

    expect(result.stored).toBe(1);
    const insert = inserts(queries, 'property_attributes')[0];
    expect(insert?.values?.[0]).toBe('property-1');
    expect(insert?.values?.[2]).toBe('property');
  });

  it('rejects a listing-scoped field, so an offer fact cannot be recorded as durable', async () => {
    const { client } = createFakeClient({ fields: { LotSizeAcres: numericField } });

    const result = await putPropertyAttributes(client, 'property-1', [
      { ...BRIGHT_KEY, value: 0.34 },
    ]);

    expect(result.rejected[0]?.reason).toBe('wrong_scope');
  });
});

describe('registerMlsField', () => {
  it('defaults is_address_bearing to TRUE when the caller omits it', async () => {
    const { client, queries } = createFakeClient({});

    await registerMlsField(client, {
      ...BRIGHT_KEY,
      resoStandardName: 'LotSizeAcres',
      dataType: 'decimal',
      scope: 'listing',
    });

    // Default-deny (#53): an unclassified field is presumed able to re-identify a suppressed address.
    // The database default alone would NOT cover this — the column is named in the INSERT.
    expect(queries[0]?.values?.[7]).toBe(true);
  });

  it('does not re-assert is_address_bearing on conflict, so a reviewed declassification survives a re-pull', async () => {
    const { client, queries } = createFakeClient({});

    await registerMlsField(client, {
      ...BRIGHT_KEY,
      resoStandardName: 'LotSizeAcres',
      dataType: 'decimal',
      scope: 'listing',
      isAddressBearing: false,
    });

    const update = queries[0]?.text ?? '';
    expect(update).toContain('DO UPDATE SET');
    expect(update.slice(update.indexOf('DO UPDATE SET'))).not.toContain('is_address_bearing');
    // Nor may a metadata sync silently change the type or the table a field lands in — attribute rows
    // already reference both through composite foreign keys.
    expect(update.slice(update.indexOf('DO UPDATE SET'))).not.toContain('data_type');
    expect(update.slice(update.indexOf('DO UPDATE SET'))).not.toContain('scope');
  });

  it('never writes is_consumer_displayable, leaving exposure default-denied in this change', async () => {
    const { client, queries } = createFakeClient({});

    await registerMlsField(client, {
      ...BRIGHT_KEY,
      resoStandardName: 'LotSizeAcres',
      dataType: 'decimal',
      scope: 'listing',
    });

    expect(queries[0]?.text).not.toContain('is_consumer_displayable');
  });
});

describe('registerMlsLookupValue', () => {
  it('adds a permitted value as an INSERT — the whole reason the registry exists', async () => {
    const { client, queries } = createFakeClient({});

    const id = await registerMlsLookupValue(client, {
      fieldId: 'field-2',
      value: 'Colonial',
      label: 'Colonial',
    });

    expect(id).toBe('generated-id');
    expect(queries[0]?.text).toContain('INSERT INTO mls_lookup_values');
    expect(queries[0]?.values).toEqual(['field-2', 'Colonial', 'Colonial', null, 0]);
  });
});

describe('the writer is fully parameterised', () => {
  it('binds one placeholder per column in the attribute INSERT', async () => {
    const { client, queries } = createFakeClient({ fields: { LotSizeAcres: numericField } });

    await putListingAttributes(client, 'listing-1', [
      { ...BRIGHT_KEY, value: 0.34 } as MlsAttributeInput,
    ]);

    const insert = inserts(queries, 'listing_attributes')[0];
    const statement = insert?.text ?? '';
    const columnList = statement.slice(statement.indexOf('(') + 1, statement.indexOf('VALUES'));
    const columnCount = columnList.split(',').filter((entry) => entry.trim().length > 0).length;
    const placeholders = new Set(
      statement
        .slice(statement.indexOf('VALUES'), statement.indexOf('ON CONFLICT'))
        .match(/\$\d+/g),
    ).size;

    // A literal in the VALUES list consumes no placeholder and shifts every later column onto the
    // wrong value — the trap this project's AGENTS.md warns about, asserted rather than reviewed.
    expect(placeholders).toBe(columnCount);
    expect(insert?.values).toHaveLength(columnCount);
  });
});
