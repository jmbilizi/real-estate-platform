/** @jest-environment node */
import { NextRequest } from 'next/server';
import { GET } from './route';
import { fetchGatewayAsUser } from '@/app/api/_lib/authed-gateway';

jest.mock('@/app/api/_lib/authed-gateway', () => ({ fetchGatewayAsUser: jest.fn() }));
const gateway = fetchGatewayAsUser as jest.Mock;

beforeEach(() => gateway.mockReset());

describe('GET /api/staff/leads/metrics', () => {
  it('forwards only the range', async () => {
    gateway.mockResolvedValue(new Response(JSON.stringify({ total: 0 }), { status: 200 }));
    const res = await GET(
      new NextRequest(
        'http://localhost/api/staff/leads/metrics?from=2026-10-01T00:00:00Z&status=new&x=1',
      ),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const [path, init] = gateway.mock.calls[0].slice(1);
    expect(path).toBe('/property/staff/leads/metrics?from=2026-10-01T00%3A00%3A00Z');
    expect(init.method).toBe('GET');
  });

  it('passes an upstream refusal through', async () => {
    gateway.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'forbidden', message: 'no' } }), {
        status: 403,
      }),
    );
    const res = await GET(new NextRequest('http://localhost/api/staff/leads/metrics'));
    expect(res.status).toBe(403);
  });
});
