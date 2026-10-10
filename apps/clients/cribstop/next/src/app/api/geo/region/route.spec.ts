/** @jest-environment node */
import { NextRequest } from 'next/server';
import { GET } from './route';

describe('GET /api/geo/region', () => {
  const fetchMock = jest.fn();
  const realFetch = global.fetch;

  afterAll(() => {
    global.fetch = realFetch;
  });

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ city: 'Rockville', regionCode: 'MD', countryCode: 'US' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('sends the ingress visitor IP to the gateway as X-Forwarded-For', async () => {
    const req = new NextRequest('http://web/api/geo/region', {
      headers: { 'x-forwarded-for': '203.0.113.5, 10.244.0.9' },
    });

    const res = await GET(req);

    expect(await res.json()).toEqual({ city: 'Rockville', state: 'MD' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/geo/region');
    expect(new Headers(init.headers as HeadersInit).get('X-Forwarded-For')).toBe('203.0.113.5');
  });

  it('sends no client IP when the header is not an IP literal', async () => {
    const req = new NextRequest('http://web/api/geo/region', {
      headers: { 'x-forwarded-for': 'not-an-ip' },
    });
    await GET(req);
    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init.headers as HeadersInit).has('X-Forwarded-For')).toBe(false);
  });
});
