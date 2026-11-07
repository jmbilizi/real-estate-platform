/** @jest-environment node */
import { NextRequest } from 'next/server';
import { fetchGateway } from '@/app/api/_lib/gateway';
import { POST } from './route';

jest.mock('@/app/api/_lib/gateway', () => ({ fetchGateway: jest.fn() }));
jest.mock('@/app/api/_lib/refresh', () => ({ tryRefreshToken: jest.fn() }));
const mockFetch = fetchGateway as jest.Mock;

const post = (body: unknown, headers: Record<string, string> = { cookie: 'access_token=tok' }) =>
  new NextRequest('http://localhost/api/account/recently-viewed', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

beforeEach(() => mockFetch.mockReset());

describe('POST /api/account/recently-viewed', () => {
  it('forwards only the listing id, as the signed-in user', async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 204 }));
    const res = await POST(post({ listingId: 'L1', extra: 'x' }));

    expect(res.status).toBe(204);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const [path, init] = mockFetch.mock.calls[0];
    expect(path).toBe('/account/recently-viewed');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body)).toEqual({ listingId: 'L1' });
  });

  it('refuses a body with no listing id', async () => {
    expect((await POST(post({}))).status).toBe(400);
    expect((await POST(post('not json'))).status).toBe(400);
    expect((await POST(post({ listingId: '' }))).status).toBe(400);
    expect((await POST(post({ listingId: 'a'.repeat(65) }))).status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('keeps the upstream failure status', async () => {
    mockFetch.mockResolvedValue(new Response('{}', { status: 400 }));
    expect((await POST(post({ listingId: '!' }))).status).toBe(400);
  });
});
