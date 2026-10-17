import { defaultShouldDehydrateQuery, isServer, QueryClient } from '@tanstack/react-query';
import { ListingsApiError } from '@/lib/api/listings';
import { AuthError } from '@/lib/api/account';

const MAX_RETRIES = 1;

/** No retry for a client error, a 401, or a cancelled request. One retry for 5xx and network errors. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return false;
  if (error instanceof AuthError) return false;
  if (error instanceof ListingsApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < MAX_RETRIES;
}

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // The gateway sends `max-age=60`. A fresh window of 60 s also stops a refetch right after
        // server-rendered data hydrates.
        staleTime: 60_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: shouldRetry,
      },
      dehydrate: {
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) || query.state.status === 'pending',
      },
    },
  });
}

let browserClient: QueryClient | undefined;

/** A new client for each server request. One shared client in the browser. */
export function getQueryClient(): QueryClient {
  if (isServer) return makeQueryClient();
  browserClient ??= makeQueryClient();
  return browserClient;
}
