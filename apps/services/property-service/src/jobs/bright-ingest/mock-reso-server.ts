/**
 * An in-process mock of Bright's RESO Web API, for the tests (#92).
 *
 * CI never holds Bright credentials, so every test in this directory runs against this. It is a
 * `FetchLike`, not an HTTP listener: a listener would need a real TLS certificate to satisfy the
 * https-only rule in `config.ts`, and would leave a socket to leak between suites.
 *
 * ## It enforces the behaviours that cost us something, not a generic OData surface
 *
 * A mock that answers everything proves nothing. This one reproduces the four Bright behaviours the
 * job has to survive, all observed on the live test feed on 2026-09-18:
 *
 *  1. **An ordered request with no bounding filter never returns.** Bright runs past 300 seconds and
 *     the request dies. Here it rejects with a distinctive error, so a code path that emits one
 *     fails a test instead of hanging CI.
 *  2. **Paging is `@odata.nextLink`,** default page size 1000, and the link is server-supplied.
 *  3. **No response carries a rate-limit header.** There is no `Retry-After` to read, which is why
 *     `rate-limiter.ts` is client-side.
 *  4. **A 429 or a 5xx is a bare status.** The injected failure queue produces them.
 *
 * `$filter` support is deliberately narrow: the one predicate `odata-query.ts` emits, Bright's own
 * 400 for an `or`, and a hard error for anything else. A permissive parser would quietly accept a
 * filter the real feed rejects, and the suite would stop testing the thing it exists to test.
 */

import type { FetchLike } from './bright-client';
import { isOrderedWithoutFilter } from './odata-query';

export const UNBOUNDED_SCAN_ERROR =
  'MOCK RESO: an $orderby with no bounding $filter never returns on Bright (observed past 300s).';

export interface MockResoOptions {
  readonly tokenEndpoint: string;
  readonly serviceRoot: string;
  /** Entity set name to its records. Records need the key and cursor fields of that resource. */
  readonly records: Readonly<Record<string, readonly Record<string, unknown>[]>>;
  /** Bright's own default. */
  readonly pageSize?: number;
  /**
   * Consumed in order by data requests. A positive number is the status to answer instead of the
   * page; `0` answers the page normally, so a test can fail the second request and not the first.
   */
  readonly failures?: readonly number[];
  readonly accessToken?: string;
  readonly expiresInSeconds?: number;
  readonly metadataBody?: string;
}

export interface MockResoServer {
  readonly fetchImpl: FetchLike;
  /** Every URL requested, in order. The assertions read this. */
  readonly requests: string[];
  /** Data-page URLs only, so an assertion about ordering is not diluted by the token call. */
  readonly pageRequests: string[];
  readonly tokenRequests: number;
}

interface ParsedFilter {
  readonly cursorField: string;
  readonly instant: number;
  /** Inclusive of the instant when there is no key, strictly after `(instant, key)` when there is. */
  readonly keyField: string | null;
  readonly key: number | null;
  /** True when Bright would answer 400 rather than run the query. */
  readonly rejected: boolean;
}

export const OR_REJECTED_ERROR =
  'SubSystem(SearchEngine) = 20015 - Query Too Complex - Message = OR Expressions allowed in top ' +
  '2 levels only. Actual level = 2';

/**
 * Parses the one predicate shape Bright accepts from this job, and refuses the rest the way Bright
 * refuses it.
 *
 * `or` is rejected with Bright's own message. Measured 2026-09-19: the strict `(t, key)` resume
 * predicate answers 400, parenthesised or not. A mock that quietly accepted it would let the job
 * ship a query the feed will never answer.
 */
function parseFilter(filter: string): ParsedFilter {
  if (/\bor\b/i.test(filter)) {
    return { cursorField: '', instant: Number.NaN, keyField: null, key: null, rejected: true };
  }

  const simple = /^(\w+) ge (\S+)$/.exec(filter);
  if (simple !== null) {
    return {
      cursorField: simple[1] ?? '',
      instant: Date.parse(simple[2] ?? ''),
      keyField: null,
      key: null,
      rejected: false,
    };
  }

  throw new Error(
    `MOCK RESO: unsupported $filter "${filter}". The mock supports only the predicate ` +
      'odata-query.ts emits. Widening it is a deliberate change, not a fix.',
  );
}

function matches(record: Record<string, unknown>, filter: ParsedFilter): boolean {
  const at = Date.parse(String(record[filter.cursorField] ?? ''));
  if (Number.isNaN(at)) {
    return false;
  }
  if (filter.keyField === null) {
    return at >= filter.instant;
  }
  if (at > filter.instant) {
    return true;
  }
  return at === filter.instant && Number(record[filter.keyField]) > (filter.key ?? 0);
}

function response(status: number, body: string, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : status === 429 ? 'Too Many Requests' : 'Error',
    // Deliberately no rate-limit header and no Retry-After. Bright sends neither.
    headers: {
      get: (name: string) =>
        headers[Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase()) ?? ''] ??
        null,
    },
    text: () => Promise.resolve(body),
  };
}

export function createMockResoServer(options: MockResoOptions): MockResoServer {
  const pageSize = options.pageSize ?? 1000;
  const accessToken = options.accessToken ?? 'mock-access-token';
  const failures = [...(options.failures ?? [])];
  const base = options.serviceRoot.replace(/\/+$/, '');

  const server: {
    requests: string[];
    pageRequests: string[];
    tokenRequests: number;
    fetchImpl: FetchLike;
  } = {
    requests: [],
    pageRequests: [],
    tokenRequests: 0,
    fetchImpl: () => Promise.reject(new Error('unset')),
  };

  server.fetchImpl = (url, init) => {
    server.requests.push(url);

    if (init.method === 'POST' && url === options.tokenEndpoint) {
      server.tokenRequests += 1;
      return Promise.resolve(
        response(
          200,
          JSON.stringify({
            access_token: accessToken,
            token_type: 'Bearer',
            expires_in: options.expiresInSeconds ?? 3600,
            scope: 'clientcred',
          }),
        ),
      );
    }

    if (url === `${base}/$metadata`) {
      return Promise.resolve(
        response(200, options.metadataBody ?? '<edmx:Edmx Version="4.0"/>', {
          'OData-Version': '4.0',
        }),
      );
    }

    if (init.headers.Authorization !== `Bearer ${accessToken}`) {
      return Promise.resolve(response(401, JSON.stringify({ error: 'invalid_grant' })));
    }

    // Rule 1. Reject rather than hang, so a defect is a red test and not a CI timeout.
    if (isOrderedWithoutFilter(url)) {
      return Promise.reject(new Error(UNBOUNDED_SCAN_ERROR));
    }

    server.pageRequests.push(url);

    // `0` lets a request through while still consuming a slot, so a test can fail the Nth page.
    const injected = failures.shift();
    if (injected !== undefined && injected > 0) {
      return Promise.resolve(response(injected, ''));
    }

    const parsed = new URL(url);
    const entitySet = parsed.pathname.slice(parsed.pathname.lastIndexOf('/') + 1);
    const all = options.records[entitySet];
    if (all === undefined) {
      return Promise.resolve(response(404, JSON.stringify({ error: 'invalid_request' })));
    }

    const filterRaw = parsed.searchParams.get('$filter');
    if (filterRaw === null) {
      return Promise.reject(new Error(UNBOUNDED_SCAN_ERROR));
    }
    const filter = parseFilter(filterRaw);
    if (filter.rejected) {
      return Promise.resolve(
        response(400, JSON.stringify({ error: { code: '400', message: OR_REJECTED_ERROR } })),
      );
    }

    const orderBy = parsed.searchParams.get('$orderby') ?? '';
    const [cursorField, keyField] = orderBy.split(',').map((part) => part.trim().split(/\s+/)[0]);

    const selected = all
      .filter((record) => matches(record, filter))
      .sort((a, b) => {
        const at = Date.parse(String(a[cursorField ?? ''] ?? ''));
        const bt = Date.parse(String(b[cursorField ?? ''] ?? ''));
        if (at !== bt) {
          return at - bt;
        }
        return Number(a[keyField ?? '']) - Number(b[keyField ?? '']);
      });

    // `$top` is "give me this many and stop", NOT a page size. Measured 2026-09-19: `$top=1000`
    // returns 1000 records with NO `@odata.nextLink`, where the same query without it returns 1000
    // WITH one. Reproduced here so a job that sends `$top` fails the paging tests instead of
    // silently replicating one page and reporting itself caught up.
    const topRaw = parsed.searchParams.get('$top');
    const top = topRaw === null ? null : Number(topRaw);
    const skip = Number(parsed.searchParams.get('$skiptoken') ?? '0');
    const size =
      top !== null && Number.isFinite(top) && top > 0 ? Math.min(top, pageSize) : pageSize;
    const page = selected.slice(skip, skip + size);

    const body: Record<string, unknown> = { value: page };
    if (top === null && skip + page.length < selected.length) {
      const next = new URL(url);
      next.searchParams.set('$skiptoken', String(skip + page.length));
      body['@odata.nextLink'] = next.toString();
    }

    return Promise.resolve(response(200, JSON.stringify(body)));
  };

  return server as MockResoServer;
}

/** An in-memory `BrightStagingStore`, so a run test needs no database. */
export function createMemoryStore() {
  const rows = new Map<string, { modifiedAt: string; payload: unknown; runId: string }>();
  const cursors = new Map<string, { modifiedAt: string | null; recordKey: string | null }>();
  const commits: { resource: string; count: number; cursor: unknown }[] = [];

  return {
    rows,
    cursors,
    commits,
    store: {
      readCursor: (resource: string) =>
        Promise.resolve(cursors.get(resource) ?? { modifiedAt: null, recordKey: null }),
      commitBatch: (params: {
        resource: string;
        runId: string;
        records: readonly { recordKey: string; modifiedAt: string; payload: unknown }[];
        cursor: { modifiedAt: string | null; recordKey: string | null };
      }) => {
        for (const record of params.records) {
          rows.set(`${params.resource}\u0000${record.recordKey}`, {
            modifiedAt: record.modifiedAt,
            payload: record.payload,
            runId: params.runId,
          });
        }
        cursors.set(params.resource, params.cursor);
        commits.push({
          resource: params.resource,
          count: params.records.length,
          cursor: params.cursor,
        });
        return Promise.resolve(params.records.length);
      },
      resetCursor: (resource: string) => {
        cursors.set(resource, { modifiedAt: null, recordKey: null });
        return Promise.resolve();
      },
      countStaged: (resource: string) =>
        Promise.resolve(
          [...rows.keys()].filter((key) => key.startsWith(`${resource}\u0000`)).length,
        ),
    },
  };
}
