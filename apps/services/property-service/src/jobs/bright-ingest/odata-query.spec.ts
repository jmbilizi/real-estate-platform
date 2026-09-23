import { buildCursorQuery, isOrderedWithoutFilter } from './odata-query';
import { BRIGHT_RESOURCES, resolveResource } from './resources';

const SERVICE_ROOT = 'https://bright-reso.tst.example.test/RESO/OData/bright';

/** Only `BrightProperties` accepts a `$filter` on this feed tier. See `resources.ts`. */
const CURSOR_RESOURCES = Object.values(BRIGHT_RESOURCES)
  .filter((resource) => resource.supportsCursorQuery)
  .map((resource) => resource.entitySet);

function query(name: string, cursor: { modifiedAt: string; recordKey: string | null }): URL {
  return new URL(
    buildCursorQuery({ serviceRoot: SERVICE_ROOT, resource: resolveResource(name), cursor }),
  );
}

describe('buildCursorQuery — every ordered request is bounded', () => {
  /**
   * The rule this module exists for. `$orderby=ModificationTimestamp asc` with no `$filter` runs
   * past 300 seconds on Bright and the request dies; the same query with a bounding filter returns
   * in about 3 seconds. The builder has no argument shape that emits one without the other.
   */
  it.each(CURSOR_RESOURCES)('%s: filters and orders on the same cursor field', (name) => {
    const resource = resolveResource(name);
    const url = query(name, { modifiedAt: '2026-09-01T00:00:00.000Z', recordKey: null });

    expect(url.searchParams.get('$filter')).toBe(
      `${resource.cursorField} ge 2026-09-01T00:00:00.000Z`,
    );
    expect(url.searchParams.get('$orderby')).toBe(
      `${resource.cursorField} asc,${resource.keyField} asc`,
    );
    expect(isOrderedWithoutFilter(url.toString())).toBe(false);
  });

  /**
   * Bright answers 400 to the strict `(instant, key)` resume predicate: "OR Expressions allowed in
   * top 2 levels only". So the filter stays inclusive whether or not a tiebreak key is stored, and
   * the staging upsert absorbs the re-read. A regression here is a nightly 400.
   */
  it('emits no OR, even when a tiebreak key is stored', () => {
    const url = query('BrightProperties', {
      modifiedAt: '2026-09-01T00:00:00.000Z',
      recordKey: '650158656022',
    });

    expect(url.searchParams.get('$filter')).toBe(
      'ModificationTimestamp ge 2026-09-01T00:00:00.000Z',
    );
    expect(url.search).not.toMatch(/\bor\b/i);
  });

  /**
   * Measured 2026-09-19: `$top=1000` returns 1000 records with NO `@odata.nextLink`, where the same
   * query without `$top` returns 1000 WITH one. `$top` is "give me this many and stop". Sending it
   * would cap every run at one page and look like a feed that is always caught up.
   */
  it('sends $top only when the caller asks for an explicit page size', () => {
    const url = query('BrightProperties', { modifiedAt: '2026-09-01T00:00:00Z', recordKey: null });
    expect(url.searchParams.has('$top')).toBe(false);

    const sized = new URL(
      buildCursorQuery({
        serviceRoot: SERVICE_ROOT,
        resource: resolveResource('BrightProperties'),
        cursor: { modifiedAt: '2026-09-01T00:00:00Z', recordKey: null },
        top: 200,
      }),
    );
    expect(sized.searchParams.get('$top')).toBe('200');
    expect(sized.searchParams.get('$filter')).toBe(
      'ModificationTimestamp ge 2026-09-01T00:00:00.000Z',
    );
  });

  it('targets the BrightProperties entity set, never the RESO-standard Property', () => {
    const url = query('BrightProperties', { modifiedAt: '2026-01-01T00:00:00Z', recordKey: null });
    expect(url.pathname).toBe('/RESO/OData/bright/BrightProperties');
  });

  it('joins a service root that already ends in a slash', () => {
    const url = new URL(
      buildCursorQuery({
        serviceRoot: `${SERVICE_ROOT}/`,
        resource: resolveResource('BrightProperties'),
        cursor: { modifiedAt: '2026-01-01T00:00:00Z', recordKey: null },
      }),
    );
    expect(url.pathname).toBe('/RESO/OData/bright/BrightProperties');
  });

  it('adds $select only when fields are named', () => {
    const withSelect = new URL(
      buildCursorQuery({
        serviceRoot: SERVICE_ROOT,
        resource: resolveResource('BrightProperties'),
        cursor: { modifiedAt: '2026-01-01T00:00:00Z', recordKey: null },
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

  it('rejects a cursor instant it cannot parse', () => {
    expect(() =>
      query('BrightProperties', { modifiedAt: 'last Tuesday', recordKey: null }),
    ).toThrow(/not a valid ISO-8601/);
  });
});

describe('resources — what the feed actually supports', () => {
  /**
   * The cursor field is per resource. `BrightMedia` has no `ModificationTimestamp` at all, so a
   * constant would have produced a query Bright rejects as an undefined property.
   */
  it('records a cursor field per resource, not one constant', () => {
    expect(BRIGHT_RESOURCES.BrightProperties?.cursorField).toBe('ModificationTimestamp');
    expect(BRIGHT_RESOURCES.BrightMedia?.cursorField).toBe('MediaModificationTimestamp');
    expect(BRIGHT_RESOURCES.Deletion?.cursorField).toBe('DeletionTimestamp');
  });

  /**
   * Measured 2026-09-19 on the BRIGHTIDXTEST account: `BrightMedia` and `Deletion` answer 400 to
   * every `$filter`, including one on their own key, and `Deletion` refuses `$orderby` as well.
   * Configuring either would produce a nightly failed Job rather than data, so the job refuses at
   * startup with the evidence instead.
   */
  it.each(['BrightMedia', 'Deletion'])(
    'refuses %s, which this feed tier will not filter',
    (name) => {
      expect(BRIGHT_RESOURCES[name]?.supportsCursorQuery).toBe(false);
      expect(() => resolveResource(name)).toThrow(/cannot be replicated incrementally/);
    },
  );

  it('fails loudly on an unknown resource rather than replicating nothing', () => {
    expect(() => resolveResource('Property')).toThrow(/Unknown Bright resource/);
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
