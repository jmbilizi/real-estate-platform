import { AuthError } from '@/lib/api/account';
import { ListingsApiError } from '@/lib/api/listings';
import {
  getQueryClient,
  makeQueryClient,
  MAX_RETRIES,
  MAX_RETRY_AFTER_MS,
  retryDelay,
  shouldRetry,
} from './query-client';

describe('shouldRetry', () => {
  it('does not retry a 4xx listings error', () => {
    expect(shouldRetry(0, new ListingsApiError('x', 'not_found', 404))).toBe(false);
  });

  it('does not retry an AuthError', () => {
    expect(shouldRetry(0, new AuthError(401))).toBe(false);
  });

  it('does not retry an AbortError', () => {
    expect(shouldRetry(0, new DOMException('aborted', 'AbortError'))).toBe(false);
  });

  it('retries a 5xx error three times', () => {
    const error = new ListingsApiError('x', 'internal_error', 503);
    expect(shouldRetry(MAX_RETRIES - 1, error)).toBe(true);
    expect(shouldRetry(MAX_RETRIES, error)).toBe(false);
  });

  it('retries a 429 three times', () => {
    const error = new ListingsApiError('x', 'rate_limited', 429, 2_000);
    expect(shouldRetry(0, error)).toBe(true);
    expect(shouldRetry(MAX_RETRIES, error)).toBe(false);
  });

  it('retries a network error three times', () => {
    expect(shouldRetry(MAX_RETRIES - 1, new TypeError('fetch failed'))).toBe(true);
    expect(shouldRetry(MAX_RETRIES, new TypeError('fetch failed'))).toBe(false);
  });
});

describe('retryDelay', () => {
  it('backs off exponentially with jitter', () => {
    const error = new TypeError('fetch failed');
    expect(retryDelay(0, error, () => 0)).toBe(250);
    expect(retryDelay(0, error, () => 1)).toBe(500);
    expect(retryDelay(2, error, () => 1)).toBe(2_000);
    expect(retryDelay(10, error, () => 1)).toBe(8_000);
  });

  it('waits for a Retry-After', () => {
    const error = new ListingsApiError('x', 'rate_limited', 429, 3_000);
    expect(retryDelay(0, error, () => 0)).toBe(3_000);
  });

  it('caps a long Retry-After', () => {
    const error = new ListingsApiError('x', 'rate_limited', 429, 60_000);
    expect(retryDelay(0, error, () => 0)).toBe(MAX_RETRY_AFTER_MS);
  });
});

describe('makeQueryClient', () => {
  it('sets the documented defaults', () => {
    const options = makeQueryClient().getDefaultOptions();
    expect(options.queries?.staleTime).toBe(60_000);
    expect(options.queries?.gcTime).toBe(300_000);
    const onFocus = options.queries?.refetchOnWindowFocus as (q: unknown) => boolean;
    expect(onFocus({ state: { status: 'error' } })).toBe(true);
    expect(onFocus({ state: { status: 'success' } })).toBe(false);
  });

  it('dehydrates a pending query', () => {
    const client = makeQueryClient();
    void client.prefetchQuery({ queryKey: ['p'], queryFn: () => new Promise(() => undefined) });
    const query = client.getQueryCache().find({ queryKey: ['p'] });
    const should = client.getDefaultOptions().dehydrate?.shouldDehydrateQuery;
    expect(should?.(query as never)).toBe(true);
  });
});

describe('getQueryClient', () => {
  it('returns one client in the browser', () => {
    expect(getQueryClient()).toBe(getQueryClient());
  });
});
