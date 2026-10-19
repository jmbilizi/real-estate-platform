/** @jest-environment node */
import { NextRequest } from 'next/server';
import { clearListingsReadCache } from '@/app/api/_lib/listings-gateway';
import { POST } from './route';

jest.mock('@/app/api/_lib/gateway', () => ({ fetchGateway: jest.fn() }));
const { fetchGateway } = jest.requireMock('@/app/api/_lib/gateway') as { fetchGateway: jest.Mock };

const upstream = (body: unknown): Response =>
  ({
    ok: true,
    status: 200,
    headers: new Headers({ 'cache-control': 'public, max-age=60' }),
    json: () => Promise.resolve(body),
  }) as unknown as Response;

const req = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest('http://localhost/api/listings/batch', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers,
  });

const row = { id: 'a', params: { listingType: 'sale', city: 'Rockville' } };

describe('POST /api/listings/batch (#960)', () => {
  beforeEach(() => clearListingsReadCache());
  afterEach(() => fetchGateway.mockReset());

  it('relays the batch to the gateway once and answers the repeat from the cache', async () => {
    fetchGateway.mockResolvedValue(upstream({ rows: [] }));

    const first = await POST(req({ rows: [row] }, { 'x-forwarded-for': '203.0.113.5' }));
    const second = await POST(req({ rows: [row] }, { 'x-forwarded-for': '198.51.100.7' }));

    expect(first.status).toBe(200);
    expect(await second.json()).toEqual({ rows: [] });
    expect(fetchGateway).toHaveBeenCalledTimes(1);
    const [path, init] = fetchGateway.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/property/listings/batch');
    expect(new Headers(init.headers).get('x-forwarded-for')).toBe('203.0.113.5');
  });

  it('forwards no cookie or authorization header', async () => {
    fetchGateway.mockResolvedValue(upstream({ rows: [] }));

    await POST(req({ rows: [row] }, { cookie: 'session=secret', authorization: 'Bearer x' }));

    const [, init] = fetchGateway.mock.calls[0] as [string, RequestInit];
    const sent = new Headers(init.headers);
    expect(sent.has('cookie')).toBe(false);
    expect(sent.has('authorization')).toBe(false);
  });

  it('rejects a bad body, an unknown parameter and an oversized body', async () => {
    const unknownParam = { rows: [{ id: 'a', params: { occupants: '4' } }] };
    for (const body of ['not json', { rows: [] }, unknownParam, 'x'.repeat(20_000)]) {
      const res = await POST(req(body));
      expect(res.status).toBe(400);
    }
    expect(fetchGateway).not.toHaveBeenCalled();
  });
});
