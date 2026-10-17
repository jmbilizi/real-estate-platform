import { AuthError } from '@/lib/api/account';
import { ListingsApiError } from '@/lib/api/listings';
import { getQueryClient, makeQueryClient, shouldRetry } from './query-client';

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

  it('retries a 5xx error once', () => {
    const error = new ListingsApiError('x', 'internal_error', 503);
    expect(shouldRetry(0, error)).toBe(true);
    expect(shouldRetry(1, error)).toBe(false);
  });

  it('retries a network error once', () => {
    expect(shouldRetry(0, new TypeError('fetch failed'))).toBe(true);
    expect(shouldRetry(1, new TypeError('fetch failed'))).toBe(false);
  });
});

describe('makeQueryClient', () => {
  it('sets the documented defaults', () => {
    const options = makeQueryClient().getDefaultOptions();
    expect(options.queries?.staleTime).toBe(60_000);
    expect(options.queries?.gcTime).toBe(300_000);
    expect(options.queries?.refetchOnWindowFocus).toBe(false);
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
