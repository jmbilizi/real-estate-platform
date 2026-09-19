import { buildCursorQuery, isOrderedWithoutFilter } from './odata-query';
import { BRIGHT_RESOURCE_NAMES, BRIGHT_RESOURCES, resolveResource } from './resources';

const SERVICE_ROOT = 'https://bright-reso.tst.example.test/RESO/OData/bright';

function query(name: string, cursor: { modifiedAt: string; recordKey: string | null }): URL {
  return new URL(
    buildCursorQuery({
      serviceRoot: SERVICE_ROOT,
      resource: resolveResource(name),
      cursor,
      pageSize: 1000,
    }),
  );
}

describe('buildCursorQuery — every ordered request is bounded', () => {
  /**
   * The rule this module exists for. `$orderby=ModificationTimestamp asc` with no `$filter` runs
   * past 300 seconds on Bright and the request dies; the same query with a bounding filter returns
   * in 3.3 seconds. This is asserted for every resource and for both cursor states, because the
   * builder is the only thing standing between the job and a CronJob that never finishes.
   */
  it.each(BRIGHT_RESOURCE_NAMES)(
    '%s: a first pass filters and orders on the cursor field',
    (name) => {
      const resource = resolveResource(name);
      const url = query(name, { modifiedAt: '2026-09-01T00:00:00.000Z', recordKey: null });

      expect(url.searchParams.get('$filter')).toBe(
        `${resource.cursorField} ge 2026-09-01T00:00:00.000Z`,
      );
      expect(url.searchParams.get('$orderby')).toBe(
        `${resource.cursorField} asc,${resource.keyField} asc`,
      );
      expect(isOrderedWithoutFilter(url.toString())).toBe(false);
    },
  );

  it.each(BRIGHT_RESOURCE_NAMES)(
    '%s: a resumed pass is strict on the (instant, key) pair',
    (name) => {
      const resource = resolveResource(name);
      const url = query(name, { modifiedAt: '2026-09-01T00:00:00.000Z', recordKey: '4242' });

      expect(url.searchParams.get('$filter')).toBe(
        `(${resource.cursorField} gt 2026-09-01T00:00:00.000Z) or ` +
          `(${resource.cursorField} eq 2026-09-01T00:00:00.000Z and ${resource.keyField} gt 4242)`,
      );
      expect(isOrderedWithoutFilter(url.toString())).toBe(false);
    },
  );

  /**
   * The cursor field is per resource and is NOT `ModificationTimestamp` everywhere. `BrightMedia`
   * has no such field, so a constant would have produced a query Bright rejects.
   */
  it('uses the resource own cursor field, not a constant', () => {
    expect(BRIGHT_RESOURCES.BrightProperties?.cursorField).toBe('ModificationTimestamp');
    expect(BRIGHT_RESOURCES.BrightMedia?.cursorField).toBe('MediaModificationTimestamp');
    expect(BRIGHT_RESOURCES.Deletion?.cursorField).toBe('DeletionTimestamp');

    const media = query('BrightMedia', { modifiedAt: '2026-01-01T00:00:00.000Z', recordKey: null });
    expect(media.searchParams.get('$filter')).toBe(
      'MediaModificationTimestamp ge 2026-01-01T00:00:00.000Z',
    );
    expect(media.searchParams.get('$orderby')).toBe('MediaModificationTimestamp asc,MediaKey asc');
  });

  it('targets the BrightProperties entity set, never the RESO-standard Property', () => {
    const url = query('BrightProperties', { modifiedAt: '2026-01-01T00:00:00Z', recordKey: null });
    expect(url.pathname).toBe('/RESO/OData/bright/BrightProperties');
  });

  it('carries $top and joins a service root that already ends in a slash', () => {
    const url = new URL(
      buildCursorQuery({
        serviceRoot: `${SERVICE_ROOT}/`,
        resource: resolveResource('BrightProperties'),
        cursor: { modifiedAt: '2026-01-01T00:00:00Z', recordKey: null },
        pageSize: 250,
      }),
    );
    expect(url.pathname).toBe('/RESO/OData/bright/BrightProperties');
    expect(url.searchParams.get('$top')).toBe('250');
  });

  it('adds $select only when fields are named', () => {
    const withSelect = new URL(
      buildCursorQuery({
        serviceRoot: SERVICE_ROOT,
        resource: resolveResource('BrightProperties'),
        cursor: { modifiedAt: '2026-01-01T00:00:00Z', recordKey: null },
        pageSize: 10,
        select: ['ListingKey', 'ModificationTimestamp'],
      }),
    );
    expect(withSelect.searchParams.get('$select')).toBe('ListingKey,ModificationTimestamp');
    expect(
      query('BrightProperties', {
        modifiedAt: '2026-01-01T00:00:00Z',
        recordKey: null,
      }).searchParams.has('$select'),
    ).toBe(false);
  });
});

describe('buildCursorQuery — refuses input that would break the bound', () => {
  it('rejects a cursor instant it cannot parse', () => {
    expect(() =>
      query('BrightProperties', { modifiedAt: 'last Tuesday', recordKey: null }),
    ).toThrow(/not a valid ISO-8601/);
  });

  /**
   * The key comes back from Bright's own payload and is then spliced into a query string. Every
   * Bright key is Edm.Int64, so anything that is not an integer is either a schema change or an
   * attempt to write OData through our cursor.
   */
  it('rejects a non-integer tiebreak key', () => {
    expect(() =>
      query('BrightProperties', {
        modifiedAt: '2026-01-01T00:00:00Z',
        recordKey: '1 or ListingKey gt 0',
      }),
    ).toThrow(/not an integer/);
  });

  it('rejects a page size that is not a positive integer', () => {
    expect(() =>
      buildCursorQuery({
        serviceRoot: SERVICE_ROOT,
        resource: resolveResource('BrightProperties'),
        cursor: { modifiedAt: '2026-01-01T00:00:00Z', recordKey: null },
        pageSize: 0,
      }),
    ).toThrow(/positive integer/);
  });
});

describe('isOrderedWithoutFilter', () => {
  it('flags an ordered request with no filter', () => {
    expect(
      isOrderedWithoutFilter('https://h.test/BrightProperties?$orderby=ModificationTimestamp asc'),
    ).toBe(true);
  });

  /** Ordering on a field the filter never mentions is the same unbounded scan with extra steps. */
  it('flags a filter that does not bound the ordered field', () => {
    expect(
      isOrderedWithoutFilter(
        'https://h.test/BrightProperties?$filter=StandardStatus eq %27Active%27&$orderby=ModificationTimestamp asc',
      ),
    ).toBe(true);
  });

  it('passes an unordered request and a correctly bounded one', () => {
    expect(isOrderedWithoutFilter('https://h.test/BrightProperties?$top=1')).toBe(false);
    expect(
      isOrderedWithoutFilter(
        query('BrightProperties', {
          modifiedAt: '2026-01-01T00:00:00Z',
          recordKey: null,
        }).toString(),
      ),
    ).toBe(false);
  });
});

describe('resolveResource', () => {
  it('fails loudly on an unknown resource rather than replicating nothing', () => {
    expect(() => resolveResource('Property')).toThrow(/Unknown Bright resource/);
  });
});
