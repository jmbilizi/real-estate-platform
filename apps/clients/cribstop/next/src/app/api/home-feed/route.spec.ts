/** @jest-environment node */
import { NextRequest } from 'next/server';
import { fetchGateway } from '@/app/api/_lib/gateway';
import { POST } from './route';

jest.mock('@/app/api/_lib/gateway', () => ({ fetchGateway: jest.fn() }));
const mockFetch = fetchGateway as jest.Mock;

const good = {
  profile: { items: [], places: ['Rockville, MD'] },
  target: { city: 'Rockville', state: 'MD' },
  radiusKm: 8,
  side: 'sale',
  variant: 'v1',
};
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest('http://localhost/api/home-feed', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue(Response.json({ variant: 'v1', rows: [] }));
});

describe('POST /api/home-feed', () => {
  it('forwards the body only, answers no-store and never forwards cookies or the IP', async () => {
    const res = await POST(
      post(good, { cookie: 'a=b', 'x-forwarded-for': '203.0.113.7', authorization: 'Bearer x' }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const [path, init] = mockFetch.mock.calls[0];
    expect(path).toBe('/property/home-feed');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body).target).toEqual(good.target);
  });

  it('rejects a body with an unknown field, such as a demographic one', async () => {
    const res = await POST(post({ ...good, age: 40 }));
    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('sends nothing when the request carries Sec-GPC: 1', async () => {
    expect((await POST(post(good, { 'sec-gpc': '1' }))).status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('answers 502 when the gateway fails or answers an error', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 500 }));
    expect((await POST(post(good))).status).toBe(502);
    mockFetch.mockRejectedValueOnce(new Error('timeout'));
    expect((await POST(post(good))).status).toBe(502);
  });
});
