/** @jest-environment node */
import { NextRequest } from 'next/server';
import { fetchGateway } from '@/app/api/_lib/gateway';
import { POST } from './route';

jest.mock('@/app/api/_lib/gateway', () => ({ fetchGateway: jest.fn() }));
jest.mock('@/app/api/_lib/refresh', () => ({ tryRefreshToken: jest.fn() }));
const mockFetch = fetchGateway as jest.Mock;

const ANON = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const post = (body: unknown, headers: Record<string, string> = { cookie: 'access_token=tok' }) =>
  new NextRequest('http://localhost/api/analytics/account-link', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  mockFetch.mockReset();
  delete process.env.ANALYTICS_ENABLED;
});

describe('POST /api/analytics/account-link (#827)', () => {
  it('forwards only the anon id, as the signed-in user', async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 204 }));
    const res = await POST(post({ anon_id: ANON }));
    expect(res.status).toBe(204);
    const [path, init] = mockFetch.mock.calls[0];
    expect(path).toBe('/property/analytics/account-link');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body)).toEqual({ anon_id: ANON });
  });

  it('forwards nothing under Global Privacy Control', async () => {
    const res = await POST(post({ anon_id: ANON }, { cookie: 'access_token=tok', 'sec-gpc': '1' }));
    expect(res.status).toBe(204);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('forwards nothing when analytics is off', async () => {
    process.env.ANALYTICS_ENABLED = 'false';
    const res = await POST(post({ anon_id: ANON }));
    expect(res.status).toBe(204);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects a body with an extra field', async () => {
    const res = await POST(post({ anon_id: ANON, email: 'a@b.co' }));
    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('answers 401 and calls no service when there is no session', async () => {
    const res = await POST(post({ anon_id: ANON }, {}));
    expect(res.status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
