/**
 * @jest-environment node
 *
 * `next/server`'s `NextResponse` needs the Web `Request`/`Response` globals, which the project's
 * default `jsdom` environment does not provide. Node 20 has them built in, so this file alone runs
 * under the `node` environment rather than adding a polyfill every other spec would also load.
 */
import { clearListingsReadCache, clientIpOf, proxyListingsRead } from './listings-gateway';
import { READ_CACHE_MAX_BODY_CHARS, READ_CACHE_MAX_ENTRIES } from './read-cache';

/**
 * The #177 regression: Ocelot's rate limiter used to write a plain-text 429 body. This proxy
 * could not parse it, and the code the browser saw fell back to `internal_error` — the rate-limit
 * fact was lost even though the 429 status itself passed through. The gateway now emits the
 * documented JSON envelope (`apps/api-gateway/Middleware/RateLimitContract.cs`), so this asserts
 * the proxy forwards it, code and status both, rather than replacing it with the fallback.
 */
jest.mock('@/app/api/_lib/gateway', () => ({
  fetchGateway: jest.fn(),
}));

const { fetchGateway } = jest.requireMock('@/app/api/_lib/gateway') as {
  fetchGateway: jest.Mock;
};

function mockUpstream(status: number, body: unknown, ok = status >= 200 && status < 300): Response {
  return {
    ok,
    status,
    headers: new Headers(),
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('proxyListingsRead', () => {
  afterEach(() => {
    fetchGateway.mockReset();
  });

  it('forwards the gateway rate-limit envelope as a 429 with the rate_limited code', async () => {
    fetchGateway.mockResolvedValue(
      mockUpstream(429, { error: { code: 'rate_limited', message: 'Too many requests.' } }),
    );

    const response = await proxyListingsRead('');
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body).toEqual({ error: { code: 'rate_limited', message: 'Too many requests.' } });
  });

  it('forwards the gateway upstream_unavailable envelope as its own status', async () => {
    fetchGateway.mockResolvedValue(
      mockUpstream(503, {
        error: { code: 'upstream_unavailable', message: 'The service is temporarily unavailable.' },
      }),
    );

    const response = await proxyListingsRead('');
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error.code).toBe('upstream_unavailable');
  });

  it('forwards the property-service error envelope unchanged', async () => {
    fetchGateway.mockResolvedValue(
      mockUpstream(404, { error: { code: 'not_found', message: 'Listing not found.' } }),
    );

    const response = await proxyListingsRead('/some-id');
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe('not_found');
  });

  it('replaces an unparsable error body with internal_error rather than forwarding it raw', async () => {
    fetchGateway.mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers(),
      json: () => Promise.reject(new SyntaxError('not JSON')),
    } as unknown as Response);

    const response = await proxyListingsRead('');
    const body = await response.json();

    // Status is still preserved even when the body itself could not be parsed — losing the code
    // is one failure, losing the status too would be a second, avoidable one.
    expect(response.status).toBe(429);
    expect(body.error.code).toBe('internal_error');
  });

  it('falls back to a 503 when the gateway cannot be reached at all', async () => {
    fetchGateway.mockRejectedValue(new Error('ECONNREFUSED'));

    const response = await proxyListingsRead('');
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error.code).toBe('internal_error');
  });
});

function okUpstream(body: unknown, cacheControl: string | null): Response {
  const headers = new Headers();
  if (cacheControl) headers.set('cache-control', cacheControl);
  return {
    ok: true,
    status: 200,
    headers,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('proxyListingsRead server cache (#755)', () => {
  beforeEach(() => clearListingsReadCache());
  afterEach(() => fetchGateway.mockReset());

  it('answers a repeat of the same read from the cache, with one gateway call', async () => {
    fetchGateway.mockResolvedValue(okUpstream({ total: 3 }, 'public, max-age=60'));

    await proxyListingsRead('', 'pageSize=8', { cache: true });
    const second = await proxyListingsRead('', 'pageSize=8', { cache: true });

    expect(fetchGateway).toHaveBeenCalledTimes(1);
    expect(await second.json()).toEqual({ total: 3 });
  });

  it('keeps suggest writes from evicting a home row (#781)', async () => {
    fetchGateway.mockResolvedValue(okUpstream({ total: 3 }, 'public, max-age=60, s-maxage=300'));
    await proxyListingsRead('', 'pageSize=8', { cache: true });

    // More distinct suggest keys than the shared store holds.
    for (let i = 0; i < READ_CACHE_MAX_ENTRIES + 50; i += 1) {
      await proxyListingsRead('/suggest', `q=p${i}`, { cache: true, store: 'suggest' });
    }
    fetchGateway.mockClear();
    await proxyListingsRead('', 'pageSize=8', { cache: true });

    expect(fetchGateway).not.toHaveBeenCalled();
  });

  it('keeps reads with different queries apart', async () => {
    fetchGateway.mockResolvedValue(okUpstream({ total: 3 }, 'public, max-age=60'));

    await proxyListingsRead('', 'pageSize=8', { cache: true });
    await proxyListingsRead('', 'pageSize=9', { cache: true });

    expect(fetchGateway).toHaveBeenCalledTimes(2);
  });

  it('never stores a read the upstream did not allow a lifetime for', async () => {
    fetchGateway.mockResolvedValue(okUpstream({ total: 3 }, 'private, no-store'));

    await proxyListingsRead('', 'pageSize=8', { cache: true });
    await proxyListingsRead('', 'pageSize=8', { cache: true });

    expect(fetchGateway).toHaveBeenCalledTimes(2);
  });

  it('never stores an error', async () => {
    fetchGateway.mockResolvedValue(
      mockUpstream(429, { error: { code: 'rate_limited', message: 'Too many requests.' } }),
    );

    await proxyListingsRead('', 'pageSize=8', { cache: true });
    await proxyListingsRead('', 'pageSize=8', { cache: true });

    expect(fetchGateway).toHaveBeenCalledTimes(2);
  });

  it('does not store a read unless the caller opts in', async () => {
    fetchGateway.mockResolvedValue(okUpstream({ total: 3 }, 'public, max-age=60'));

    await proxyListingsRead('', 'pageSize=8');
    await proxyListingsRead('', 'pageSize=8');

    expect(fetchGateway).toHaveBeenCalledTimes(2);
  });

  it('tells the browser the time the entry has left, never more than the upstream allowed', async () => {
    fetchGateway.mockResolvedValue(
      okUpstream({ total: 3 }, 'public, max-age=60, s-maxage=300, stale-while-revalidate=60'),
    );

    await proxyListingsRead('/meta', '', { cache: true });
    const hit = await proxyListingsRead('/meta', '', { cache: true });

    expect(hit.headers.get('cache-control')).toMatch(/^public, max-age=([0-5]?\d|60)$/);
  });

  it('answers a miss and a hit with the same kind of header, with no s-maxage and no validators', async () => {
    const headers = new Headers({
      'cache-control': 'public, max-age=60, s-maxage=300',
      etag: 'W/"abc"',
    });
    fetchGateway.mockResolvedValue({
      ok: true,
      status: 200,
      headers,
      json: () => Promise.resolve({ total: 3 }),
    } as unknown as Response);

    const miss = await proxyListingsRead('/meta', '', { cache: true });
    const hit = await proxyListingsRead('/meta', '', { cache: true });

    expect(miss.headers.get('cache-control')).toBe('public, max-age=60');
    expect(miss.headers.get('etag')).toBeNull();
    expect(hit.headers.get('cache-control')).toMatch(/^public, max-age=\d+$/);
  });

  it('does not store a body larger than the limit', async () => {
    const big = { text: 'x'.repeat(READ_CACHE_MAX_BODY_CHARS + 1) };
    fetchGateway.mockResolvedValue(okUpstream(big, 'public, max-age=60'));

    await proxyListingsRead('', 'pageSize=100', { cache: true });
    await proxyListingsRead('', 'pageSize=100', { cache: true });

    expect(fetchGateway).toHaveBeenCalledTimes(2);
  });

  it('shares one gateway call between concurrent identical reads', async () => {
    fetchGateway.mockResolvedValue(okUpstream({ total: 3 }, 'public, max-age=60'));

    await Promise.all([
      proxyListingsRead('', 'a=1', { cache: true }),
      proxyListingsRead('', 'a=1', { cache: true }),
      proxyListingsRead('', 'a=1', { cache: true }),
    ]);

    expect(fetchGateway).toHaveBeenCalledTimes(1);
  });
});

describe('proxyListingsRead retry and client IP (#755)', () => {
  beforeEach(() => clearListingsReadCache());
  afterEach(() => fetchGateway.mockReset());

  it('retries once after a gateway 503 and returns the second answer', async () => {
    fetchGateway
      .mockResolvedValueOnce(
        mockUpstream(503, { error: { code: 'upstream_unavailable', message: 'Try again.' } }),
      )
      .mockResolvedValueOnce(okUpstream({ total: 1 }, 'public, max-age=60'));

    const response = await proxyListingsRead('', '');

    expect(fetchGateway).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(200);
  });

  it('repeats a read without skipTotal when an older API rejects the parameter (a deploy rolls both)', async () => {
    fetchGateway
      .mockResolvedValueOnce(
        mockUpstream(400, {
          error: {
            code: 'invalid_request',
            message:
              'Unknown query parameter(s): skipTotal. Unknown parameters are rejected; there is no field-selection parameter.',
          },
        }),
      )
      .mockResolvedValueOnce(okUpstream({ total: 40 }, 'public, max-age=60'));

    const response = await proxyListingsRead('', 'pageSize=8&skipTotal=true');

    expect(response.status).toBe(200);
    expect(fetchGateway.mock.calls[0]?.[0]).toContain('skipTotal=true');
    expect(fetchGateway.mock.calls[1]?.[0]).not.toContain('skipTotal');
    expect(fetchGateway.mock.calls[1]?.[0]).toContain('pageSize=8');
  });

  it('does not repeat a 400 that rejects the value of skipTotal, or any other parameter', async () => {
    fetchGateway.mockResolvedValue(
      mockUpstream(400, {
        error: {
          code: 'invalid_request',
          message: 'Invalid value for query parameter(s): skipTotal.',
        },
      }),
    );

    await proxyListingsRead('', 'pageSize=8&skipTotal=maybe');

    expect(fetchGateway).toHaveBeenCalledTimes(1);
  });

  it('does not retry a failure that took longer than the retry limit', async () => {
    const clock = jest.spyOn(Date, 'now');
    clock.mockReturnValueOnce(0).mockReturnValueOnce(4_000);
    fetchGateway.mockResolvedValue(
      mockUpstream(503, { error: { code: 'upstream_unavailable', message: 'Slow.' } }),
    );

    const response = await proxyListingsRead('', '');
    clock.mockRestore();

    expect(response.status).toBe(503);
    expect(fetchGateway).toHaveBeenCalledTimes(1);
  });

  it('does not repeat a 400 that carries no skipTotal', async () => {
    fetchGateway.mockResolvedValue(
      mockUpstream(400, { error: { code: 'invalid_request', message: 'Bad value' } }),
    );

    const response = await proxyListingsRead('', 'pageSize=500');

    expect(response.status).toBe(400);
    expect(fetchGateway).toHaveBeenCalledTimes(1);
  });

  it('does not retry a 429', async () => {
    fetchGateway.mockResolvedValue(
      mockUpstream(429, { error: { code: 'rate_limited', message: 'Too many requests.' } }),
    );

    await proxyListingsRead('', '');

    expect(fetchGateway).toHaveBeenCalledTimes(1);
  });

  it('sends the visitor IP as X-Forwarded-For', async () => {
    fetchGateway.mockResolvedValue(okUpstream({ total: 1 }, null));

    await proxyListingsRead('', '', { clientIp: '203.0.113.9' });

    const init = fetchGateway.mock.calls[0]?.[1] as { headers: Record<string, string> };
    expect(init.headers['X-Forwarded-For']).toBe('203.0.113.9');
  });

  it('sends no X-Forwarded-For without a visitor IP', async () => {
    fetchGateway.mockResolvedValue(okUpstream({ total: 1 }, null));

    await proxyListingsRead('', '');

    const init = fetchGateway.mock.calls[0]?.[1] as { headers: Record<string, string> };
    expect(init.headers['X-Forwarded-For']).toBeUndefined();
  });
});

describe('clientIpOf (#755)', () => {
  it('takes the first X-Forwarded-For entry', () => {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.9, 10.244.0.5' });
    expect(clientIpOf(headers)).toBe('203.0.113.9');
  });

  it('accepts an IPv6 literal', () => {
    expect(clientIpOf(new Headers({ 'x-forwarded-for': '2001:db8::1' }))).toBe('2001:db8::1');
  });

  it.each(['unknown', 'a b c', '<script>'])('refuses %p', (value) => {
    expect(clientIpOf(new Headers({ 'x-forwarded-for': value }))).toBeNull();
  });

  it('returns null without the header', () => {
    expect(clientIpOf(new Headers())).toBeNull();
  });
});
