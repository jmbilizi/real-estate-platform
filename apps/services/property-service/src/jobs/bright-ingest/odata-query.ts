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
 * ## Resuming exactly, rather than approximately
 *
 * A timestamp is not unique. Bright bulk-loads records that share a `ModificationTimestamp` to the
 * second, so "resume after instant t" has to mean "after the record (t, k) we actually reached".
 * With `ge t` alone, a run capped at N pages would re-read the same tie block on every later run and
 * never pass it — starvation, not slowness, and most likely on `Deletion`, which holds 10.5 million
 * rows on the test feed.
 *
 * So the resume predicate carries the key:
 *
 *     (cursorField gt t) or (cursorField eq t and keyField gt k)
 *
 * and the ordering carries the same tiebreak, `cursorField asc, keyField asc`, which was verified on
 * the wire. Every Bright key in `resources.ts` is `Edm.Int64`, so the key literal is a bare number
 * and `gt` on it is a total order.
 *
 * The first pass of a resource has no key yet and uses `ge t`, where `t` is the configured epoch.
 * That is still a bounding filter, which is the rule that matters.
 */

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
  /** `$top`. Bright's own default page size is 1000. */
  readonly pageSize: number;
  /** `$select`. Omitted when empty, which asks for every field. */
  readonly select?: readonly string[];
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
 * Every Bright key in `resources.ts` is `Edm.Int64`, so a key literal is bare digits.
 *
 * Validated rather than assumed: this value comes back from Bright's own payload and is then spliced
 * into a query string. Rejecting anything that is not an integer keeps that splice from being a
 * place where a feed can write OData of its own.
 */
function keyLiteral(resource: BrightResource, key: string): string {
  if (!/^-?\d{1,19}$/.test(key)) {
    throw new Error(
      `Cursor key "${key}" for ${resource.entitySet} is not an integer. ${resource.keyField} is ` +
        'Edm.Int64 in the committed $metadata document, and a non-integer here means either a feed ' +
        'schema change or a corrupted cursor row.',
    );
  }
  return key;
}

/**
 * Builds one page request. Always a bounding `$filter`, always the matching `$orderby`.
 *
 * Returns the absolute URL. `URLSearchParams` percent-encodes the filter, which Bright accepts —
 * the 2026-09-18 probes were encoded the same way.
 */
export function buildCursorQuery(params: CursorQueryParams): string {
  const { resource, cursor, pageSize } = params;

  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new Error(`Page size must be a positive integer, got ${pageSize}.`);
  }

  const instant = timestampLiteral(cursor.modifiedAt);
  const filter =
    cursor.recordKey === null
      ? `${resource.cursorField} ge ${instant}`
      : `(${resource.cursorField} gt ${instant}) or (${resource.cursorField} eq ${instant} and ` +
        `${resource.keyField} gt ${keyLiteral(resource, cursor.recordKey)})`;

  const search = new URLSearchParams();
  search.set('$filter', filter);
  search.set('$orderby', `${resource.cursorField} asc,${resource.keyField} asc`);
  search.set('$top', String(pageSize));
  if (params.select !== undefined && params.select.length > 0) {
    search.set('$select', params.select.join(','));
  }

  const base = params.serviceRoot.replace(/\/+$/, '');
  return `${base}/${resource.entitySet}?${search.toString()}`;
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
