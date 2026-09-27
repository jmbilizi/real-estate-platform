/**
 * The Bright cursor query (#92) — the one place in this service that may write `$orderby`.
 *
 * ## Why this is its own module
 *
 * Observed against the live test feed on 2026-09-18: `$orderby=ModificationTimestamp asc` with **no
 * `$filter`** does not return. It runs past 300 seconds and the request dies. The same query with
 * `$filter=ModificationTimestamp gt <t>` in front returns in 3.3 seconds. So an ordered request with
 * no bounding filter is not slow — it is a job that never finishes, on a CronJob with a 900-second
 * deadline, holding a `Forbid` concurrency lock the whole time.
 *
 * "Remember to add a filter" is not a control. This module is the control: `buildCursorQuery()` is
 * the only function that emits `$orderby`, it takes the cursor as a required argument, and it writes
 * the filter and the ordering from that one value. There is no argument shape that produces one
 * without the other. `odata-query.spec.ts` asserts it for every resource, and
 * `no-consumer-writes.spec.ts` asserts no other file in the directory contains the token `$orderby`.
 *
 * ## Two wire facts that shaped this, both measured on 2026-09-19
 *
 * **Bright rejects OR.** The exact resume predicate for a non-unique timestamp is
 * `(cursorField gt t) or (cursorField eq t and keyField gt k)`. Bright answers it **400**:
 * `SubSystem(SearchEngine) = 20015 - Query Too Complex - OR Expressions allowed in top 2 levels
 * only`. Removing the parentheses does not help; `and` binds tighter, the meaning is identical, and
 * the answer is the same 400. So a strict resume predicate is not expressible on this feed.
 *
 * The filter is therefore `cursorField ge t`, inclusive, and the records sharing the watermark
 * instant are read again on the next pass. That costs nothing: the staging primary key is
 * `(resource, record_key)` and the write is an upsert, so a re-read writes each row over itself.
 * The cursor still carries the key, because `replicate.ts` needs it to tell "this pass made
 * progress" from "this pass re-read the same tie block" — see the page-cap rule there.
 *
 * **`$top` suppresses `@odata.nextLink`.** Measured against `BrightProperties` with the same filter:
 * no `$top` returns 1000 records **with** a nextLink; `$top=1000` returns 1000 records **with no
 * nextLink**; `$top=10` returns 10 with none. So `$top` is a "give me this many and stop", not a
 * page size. Sending it would have capped every run at one page and looked like a feed that was
 * always caught up. This module therefore never sends `$top`, and page size is Bright's own default
 * of 1000.
 */

import { brightStatusFilterLabel } from '../bright-map/status';
import type { BrightResource } from './resources';

/** Where a pass resumes from. `recordKey` is absent on the first pass and after a full resync. */
export interface QueryCursor {
  /** ISO-8601 instant, `Z`-suffixed. Never null here — the caller substitutes the epoch. */
  readonly modifiedAt: string;
  readonly recordKey: string | null;
}

export interface CursorQueryParams {
  /** The OData service root, with or without a trailing slash. */
  readonly serviceRoot: string;
  readonly resource: BrightResource;
  readonly cursor: QueryCursor;
  /** `$select`. Omitted when empty, which asks for every field. */
  readonly select?: readonly string[];
  /**
   * `$top`. Omitted when absent. `$top` suppresses `@odata.nextLink` (see the header), so a caller
   * that sends it pages by re-querying from its own cursor, never by following a link.
   */
  readonly top?: number;
}

/**
 * OData v4 writes a `DateTimeOffset` literal bare, with no quotes and no `datetime` prefix.
 *
 * The value is re-parsed rather than interpolated, so a malformed cursor fails here instead of
 * reaching Bright as a broken query string. A cursor read back from the database is trusted data,
 * but it is still the input this whole query is built from.
 */
function timestampLiteral(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(
      `Cursor instant "${iso}" is not a valid ISO-8601 timestamp. A cursor query cannot be bounded ` +
        'by it, and an unbounded ordered query against Bright never returns.',
    );
  }
  return parsed.toISOString();
}

/**
 * Builds one page request. Always a bounding `$filter`, always the matching `$orderby`, never
 * `$top`.
 *
 * Returns the absolute URL. `URLSearchParams` percent-encodes the filter, which Bright accepts —
 * every probe that returned 200 was encoded the same way.
 */
export function buildCursorQuery(params: CursorQueryParams): string {
  const { resource, cursor } = params;

  if (!resource.supportsCursorQuery) {
    throw new Error(
      `${resource.entitySet} does not accept a $filter on this feed tier, so it cannot be ` +
        'replicated incrementally. See resources.ts for the wire evidence.',
    );
  }

  const instant = timestampLiteral(cursor.modifiedAt);

  const search = new URLSearchParams();
  // Inclusive, because Bright rejects the OR that a strict `(t, key)` resume needs. The staging
  // upsert makes re-reading the watermark instant free. See the header.
  search.set('$filter', `${resource.cursorField} ge ${instant}`);
  search.set('$orderby', `${resource.cursorField} asc,${resource.keyField} asc`);
  if (params.select !== undefined && params.select.length > 0) {
    search.set('$select', params.select.join(','));
  }
  if (params.top !== undefined) {
    search.set('$top', String(params.top));
  }

  const base = params.serviceRoot.replace(/\/+$/, '');
  return `${base}/${resource.entitySet}?${search.toString()}`;
}

/** OData string literal: single quotes doubled. */
function stringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Reports whether a URL breaks the rule this module exists to enforce.
 *
 * Exported so the mock RESO server in the tests can refuse an unbounded ordered request the way
 * Bright effectively does — by never answering it. A test that only checked the builder would prove
 * the builder correct and say nothing about what the job actually sends, including on the
 * `@odata.nextLink` path, where the URL is Bright's and not ours.
 */
export function isOrderedWithoutFilter(url: string): boolean {
  const query = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
  const search = new URLSearchParams(query);
  const orderBy = search.get('$orderby');
  if (orderBy === null) {
    return false;
  }
  const filter = search.get('$filter');
  if (filter === null || filter.trim().length === 0) {
    return true;
  }
  // Ordering by a field the filter does not mention is the same defect with extra steps: the scan
  // is still unbounded along the axis it sorts on.
  const orderedField = orderBy.split(',')[0]?.trim().split(/\s+/)[0] ?? '';
  return orderedField.length > 0 && !filter.includes(orderedField);
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * Sync worker queries (#338). Measured on production Bright, 2026-09-26, from the pod:
 *
 * - **Bright ignores `$orderby=ListingKey`.** `asc` and `desc` return the same unordered page, so a
 *   `ListingKey gt k` keyset skips records: a Pending pass read 5,260 of 20,080. `$orderby` on
 *   `ModificationTimestamp` is honoured, but it sorts every match first (43 s over one status).
 * - **`$count=true&$top=0` is fast** (under 1 s). The `/$count` segment answers 501.
 *
 * So the worker never relies on server order. It asks for a `$count` over a slice (a
 * `ModificationTimestamp` window, then a `ListingKey` range inside one instant), splits any slice
 * wider than one page, and reads each slice of at most one page with a single request.
 * ════════════════════════════════════════════════════════════════════════════════════════════ */

/** A place to scope a slice or a count to. Bright matches `City` case-insensitively. */
export interface BrightArea {
  readonly city?: string;
  readonly state?: string;
  readonly zip?: string;
}

function areaClauses(area: BrightArea | undefined): string[] {
  if (area === undefined) {
    return [];
  }
  return [
    ...(area.city === undefined ? [] : [`City eq ${stringLiteral(area.city)}`]),
    ...(area.state === undefined ? [] : [`StateOrProvince eq ${stringLiteral(area.state)}`]),
    ...(area.zip === undefined ? [] : [`PostalCode eq ${stringLiteral(area.zip)}`]),
  ];
}

/** OData `Edm.Date` literal: bare `YYYY-MM-DD`. */
function dateLiteral(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`"${value}" is not a YYYY-MM-DD date.`);
  }
  return value;
}

function decimalKey(value: string): string {
  if (!/^\d+$/.test(value)) {
    throw new Error(`ListingKey "${value}" is not a decimal integer.`);
  }
  return value;
}

function propertiesUrl(serviceRoot: string, search: URLSearchParams): string {
  return `${serviceRoot.replace(/\/+$/, '')}/BrightProperties?${search.toString()}`;
}

/** What a slice selects, apart from its bounds. */
export interface SliceScope {
  /** `StandardStatus` payload value, translated to its `$filter` label. Absent: every status. */
  readonly status?: string;
  readonly area?: BrightArea;
  /** `CloseDate ge <date>`. The sold backfill is never unbounded. */
  readonly closeDateFrom?: string;
}

/** `ModificationTimestamp gt from and le until`, and optionally `ListingKey gt a and le b`. */
export interface SliceBounds {
  readonly from: string;
  readonly until: string;
  readonly keyAfter?: string;
  readonly keyUntil?: string;
}

function sliceFilter(scope: SliceScope, bounds: SliceBounds): string {
  return [
    ...areaClauses(scope.area),
    ...(scope.status === undefined
      ? []
      : [`StandardStatus eq ${stringLiteral(brightStatusFilterLabel(scope.status))}`]),
    ...(scope.closeDateFrom === undefined
      ? []
      : [`CloseDate ge ${dateLiteral(scope.closeDateFrom)}`]),
    `ModificationTimestamp gt ${timestampLiteral(bounds.from)}`,
    `ModificationTimestamp le ${timestampLiteral(bounds.until)}`,
    ...(bounds.keyAfter === undefined ? [] : [`ListingKey gt ${decimalKey(bounds.keyAfter)}`]),
    ...(bounds.keyUntil === undefined ? [] : [`ListingKey le ${decimalKey(bounds.keyUntil)}`]),
  ].join(' and ');
}

/** The `$count` of one slice: an empty page that carries `@odata.count`. */
export function buildSliceCountQuery(
  serviceRoot: string,
  scope: SliceScope,
  bounds: SliceBounds,
): string {
  const search = new URLSearchParams();
  search.set('$filter', sliceFilter(scope, bounds));
  search.set('$count', 'true');
  search.set('$top', '0');
  return propertiesUrl(serviceRoot, search);
}

/**
 * One slice's records. The caller sizes the slice to one page with `buildSliceCountQuery` first,
 * so correctness does not depend on order. `ordered` adds
 * `$orderby=ModificationTimestamp asc,ListingKey asc` for the incremental window. It costs a sort,
 * so the backfill and reconcile reads leave it out.
 */
export function buildSliceQuery(
  serviceRoot: string,
  scope: SliceScope,
  bounds: SliceBounds,
  options: {
    readonly top: number;
    readonly select?: readonly string[];
    readonly ordered?: boolean;
  },
): string {
  const search = new URLSearchParams();
  search.set('$filter', sliceFilter(scope, bounds));
  if (options.ordered === true) {
    search.set('$orderby', 'ModificationTimestamp asc,ListingKey asc');
  }
  search.set('$top', String(options.top));
  if (options.select !== undefined && options.select.length > 0) {
    search.set('$select', options.select.join(','));
  }
  return propertiesUrl(serviceRoot, search);
}

export interface CountQueryParams {
  readonly serviceRoot: string;
  /** `StandardStatus` payload value; translated to its `$filter` label. */
  readonly status: string;
  readonly area?: BrightArea;
  readonly closeDateFrom?: string;
}

/** `$count=true&$top=0` over one status, with no time bounds (audit and reconcile). */
export function buildCountQuery(params: CountQueryParams): string {
  const clauses = [
    ...areaClauses(params.area),
    `StandardStatus eq ${stringLiteral(brightStatusFilterLabel(params.status))}`,
    ...(params.closeDateFrom === undefined
      ? []
      : [`CloseDate ge ${dateLiteral(params.closeDateFrom)}`]),
  ];
  const search = new URLSearchParams();
  search.set('$filter', clauses.join(' and '));
  search.set('$count', 'true');
  search.set('$top', '0');
  return propertiesUrl(params.serviceRoot, search);
}
