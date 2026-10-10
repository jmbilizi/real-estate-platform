/** @jest-environment node */
import { NextRequest } from 'next/server';
import { fetchGateway } from '@/app/api/_lib/gateway';
import { POST } from './route';

jest.mock('@/app/api/_lib/gateway', () => ({ fetchGateway: jest.fn() }));
const mockFetch = fetchGateway as jest.Mock;

const good = {
  event: 'listing_view',
  surface: 'detail',
  listingId: '0190a000-0000-7000-8000-0000000000e1',
  sessionId: 'abcdef0123456789',
};
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest('http://localhost/api/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue(new Response(null, { status: 204 }));
  delete process.env.ANALYTICS_ENABLED;
});

describe('POST /api/events', () => {
  it('forwards the body and the IP only, never cookies, user agent or auth', async () => {
    const res = await POST(
      post(good, {
        cookie: 'access_token=tok',
        'user-agent': 'SecretBrowser/9',
        authorization: 'Bearer x',
        'x-forwarded-for': '203.0.113.7',
      }),
    );
    expect(res.status).toBe(204);
    const [path, init] = mockFetch.mock.calls[0];
    expect(path).toBe('/property/analytics/events');
    expect(JSON.parse(init.body)).toEqual(good);
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      'X-Forwarded-For': '203.0.113.7',
    });
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('rejects an unknown event, an unknown field and a bad session id', async () => {
    for (const bad of [
      { ...good, event: 'hover' },
      { ...good, query: 'x' },
      { ...good, sessionId: 'a b' },
    ]) {
      expect((await POST(post(bad))).status).toBe(400);
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('sends nothing when ANALYTICS_ENABLED is false', async () => {
    process.env.ANALYTICS_ENABLED = 'false';
    expect((await POST(post(good))).status).toBe(204);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('answers 204 when the gateway fails', async () => {
    mockFetch.mockRejectedValue(new Error('down'));
    expect((await POST(post(good))).status).toBe(204);
  });
});
