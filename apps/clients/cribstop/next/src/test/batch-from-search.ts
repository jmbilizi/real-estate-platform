import type { ListingsBatchResponse, ListingsEnvelope } from '@cribstop/property-contracts';
import type { ListingsBatchQuery, ListingSearchQuery } from '@/lib/api/listings';

type Search = (query: ListingSearchQuery, signal?: AbortSignal) => Promise<ListingsEnvelope>;

/**
 * Stands in for the batch endpoint in a spec. It answers each row with the spec's own
 * `searchListings` mock, so a spec that scripts rows by query keeps working. A row with `widen`
 * repeats an empty city with its state, then with no place, as the service does (#960).
 */
export function batchFromSearch(search: Search) {
  return async (
    rows: ListingsBatchQuery[],
    signal?: AbortSignal,
  ): Promise<ListingsBatchResponse> => ({
    rows: await Promise.all(
      rows.map(async ({ id, query, widen }) => {
        const scopes =
          widen && query.city && query.state
            ? [
                { city: query.city, state: query.state },
                { state: query.state },
                {} as { city?: string; state?: string },
              ]
            : [{ city: query.city, state: query.state }];
        try {
          let last: ListingsEnvelope | null = null;
          let scope = scopes[0] ?? {};
          for (const next of scopes) {
            scope = next;
            const scoped = { ...query, city: undefined, state: undefined, ...next };
            last = await search(scoped, signal);
            if (last.results.length > 0) break;
          }
          return { id, scope, result: last as ListingsEnvelope };
        } catch {
          return {
            id,
            error: { code: 'internal_error' as const, message: 'Internal server error.' },
          };
        }
      }),
    ),
  });
}
