/** @jest-environment node */
import { NextRequest } from 'next/server';
import { fetchGateway } from '@/app/api/_lib/gateway';
import { PUT as saveListing } from '../listings/[id]/saved/route';
import { DELETE as unsaveHome } from './[id]/route';
import { GET } from './route';

jest.mock('@/app/api/_lib/gateway', () => ({ fetchGateway: jest.fn() }));
jest.mock('@/app/api/_lib/refresh', () => ({ tryRefreshToken: jest.fn() }));
const mockFetch = fetchGateway as jest.Mock;

const cookie = { cookie: 'access_token=tok' };
const req = (url: string, method = 'GET', headers: Record<string, string> = cookie) =>
  new NextRequest(url, { method, headers });

beforeEach(() => mockFetch.mockReset());

describe('saved-homes route handlers', () => {
  it('forwards only page and pageSize, as the signed-in user', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    const res = await GET(req('http://localhost/api/saved-homes?page=2&pageSize=50&evil=1'));

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const [path, init] = mockFetch.mock.calls[0];
    expect(path).toBe('/property/saved-homes?page=2&pageSize=50');
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('saves through the listing id', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ propertyId: 'p1', saved: true }), { status: 200 }),
    );
    const res = await saveListing(req('http://localhost/api/listings/l1/saved', 'PUT'), {
      params: Promise.resolve({ id: 'l1' }),
    });

    expect(await res.json()).toEqual({ propertyId: 'p1', saved: true });
    expect(mockFetch.mock.calls[0][0]).toBe('/property/listings/l1/saved');
    expect(mockFetch.mock.calls[0][1].method).toBe('PUT');
  });

  it('unsaves by property id', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ propertyId: 'p1', saved: false }), { status: 200 }),
    );
    await unsaveHome(req('http://localhost/api/saved-homes/p1', 'DELETE'), {
      params: Promise.resolve({ id: 'p1' }),
    });

    expect(mockFetch.mock.calls[0][0]).toBe('/property/saved-homes/p1');
    expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
  });

  it('answers the contract error shape and keeps the status', async () => {
    mockFetch.mockResolvedValue(new Response('<html>bad gateway</html>', { status: 503 }));
    const res = await GET(req('http://localhost/api/saved-homes'));

    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('unavailable');
  });

  it('answers 401 with no call to the gateway when there is no session', async () => {
    const res = await GET(req('http://localhost/api/saved-homes', 'GET', {}));

    expect(res.status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
