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

/** One place to load on demand (`area-fetch.ts`). At least one of `city` / `zip` is set. */
export interface AreaQueryParams {
  readonly serviceRoot: string;
  readonly city?: string;
  readonly state?: string;
  readonly zip?: string;
  /** Keyset page: the last `ListingKey` already read, as decimal text. `null` on the first page. */
  readonly afterKey: string | null;
  readonly top: number;
}

/** OData string literal: single quotes doubled. */
function stringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Builds one page of an on-demand area load: the ACTIVE `BrightProperties` in one city or ZIP.
 *
 * The area and status filters keep the match set small, so this avoids the whole-feed scan that
 * makes a `ModificationTimestamp` page slow on production. Pages are keyset pages on `ListingKey`
 * (`ListingKey gt k`, ordered by `ListingKey`): no OR, no `$skip`, and the ordered field is always
 * in the filter. `$top` suppresses nextLink, so the caller pages by `afterKey`.
 */
export function buildAreaQuery(params: AreaQueryParams): string {
  if (params.city === undefined && params.zip === undefined) {
    throw new Error('An area query needs a city or a ZIP.');
  }
  if (params.afterKey !== null && !/^\d+$/.test(params.afterKey)) {
    throw new Error(`ListingKey "${params.afterKey}" is not a decimal integer.`);
  }
  const clauses = [
    ...(params.city === undefined ? [] : [`City eq ${stringLiteral(params.city)}`]),
    ...(params.state === undefined ? [] : [`StateOrProvince eq ${stringLiteral(params.state)}`]),
    ...(params.zip === undefined ? [] : [`PostalCode eq ${stringLiteral(params.zip)}`]),
    "StandardStatus eq 'Active'",
    `ListingKey gt ${params.afterKey ?? '0'}`,
  ];

  const search = new URLSearchParams();
  search.set('$filter', clauses.join(' and '));
  search.set('$orderby', 'ListingKey asc');
  search.set('$top', String(params.top));

  const base = params.serviceRoot.replace(/\/+$/, '');
  return `${base}/BrightProperties?${search.toString()}`;
}

/** One city and one Bright `StandardStatus` value, for one `$count` request (#328). */
export interface AreaCountQueryParams {
  readonly serviceRoot: string;
  readonly city: string;
  /** The Bright wire value, e.g. `'Active'` or `'ComingSoon'` — see resources.ts on this vocabulary. */
  readonly standardStatus: string;
}

/**
 * Builds a `$count` request for one city and one status: `GET .../BrightProperties/$count?$filter=...`.
 *
 * OData v4's `$count` segment returns the row count as a bare integer body, not a page. There is
 * therefore no `$orderby` and no `$top` to get wrong here, and this function never emits either.
 * Bright rejects `OR` in `$filter` (see the module header), so a caller wanting several statuses for
 * one city sends one request per status and sums the results — this builder never joins statuses
 * itself.
 */
export function buildAreaCountQuery(params: AreaCountQueryParams): string {
  const clauses = [
    `City eq ${stringLiteral(params.city)}`,
    `StandardStatus eq ${stringLiteral(params.standardStatus)}`,
  ];

  const search = new URLSearchParams();
  search.set('$filter', clauses.join(' and '));

  const base = params.serviceRoot.replace(/\/+$/, '');
  return `${base}/BrightProperties/$count?${search.toString()}`;
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
