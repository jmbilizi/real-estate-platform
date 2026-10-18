import { defaultShouldDehydrateQuery, isServer, QueryClient } from '@tanstack/react-query';
import { ListingsApiError } from '@/lib/api/listings';
import { AuthError } from '@/lib/api/account';

/** A transient failure gets this many retries before a row shows its error card (#955). */
export const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8_000;
/** A longer `Retry-After` is cut to this, so a row never waits a full rate-limit window. */
export const MAX_RETRY_AFTER_MS = 20_000;

/**
 * Retries a 429, a 5xx and a network error up to `MAX_RETRIES` times. No retry for any other 4xx,
 * a 401, or a cancelled request.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return false;
  if (error instanceof AuthError) return false;
  if (
    error instanceof ListingsApiError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 429
  ) {
    return false;
  }
  return failureCount < MAX_RETRIES;
}

/**
 * Exponential backoff with full jitter, so rows that failed together do not retry together.
 * A 429 waits for its `Retry-After` instead.
 */
export function retryDelay(failureCount: number, error: unknown, random = Math.random): number {
  if (error instanceof ListingsApiError && error.retryAfterMs !== undefined) {
    return Math.min(error.retryAfterMs, MAX_RETRY_AFTER_MS) + random() * BASE_DELAY_MS;
  }
  const ceiling = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** failureCount);
  return ceiling / 2 + random() * (ceiling / 2);
}

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // The gateway sends `max-age=60`. A fresh window of 60 s also stops a refetch right after
        // server-rendered data hydrates.
        staleTime: 60_000,
        gcTime: 5 * 60_000,
        // Only a failed query refetches on focus. A good result stays until it goes stale.
        refetchOnWindowFocus: (query) => query.state.status === 'error',
        refetchOnReconnect: true,
        retry: shouldRetry,
        retryDelay,
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
