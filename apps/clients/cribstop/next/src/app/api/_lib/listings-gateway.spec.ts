/**
 * @jest-environment node
 *
 * `next/server`'s `NextResponse` needs the Web `Request`/`Response` globals, which the project's
 * default `jsdom` environment does not provide. Node 20 has them built in, so this file alone runs
 * under the `node` environment rather than adding a polyfill every other spec would also load.
 */
import { proxyListingsRead } from './listings-gateway';

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
