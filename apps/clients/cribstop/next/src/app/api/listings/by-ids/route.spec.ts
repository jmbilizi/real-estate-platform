/** @jest-environment node */
import { NextRequest } from 'next/server';
import { clearListingsReadCache } from '@/app/api/_lib/listings-gateway';
import { GET } from './route';

jest.mock('@/app/api/_lib/gateway', () => ({ fetchGateway: jest.fn() }));
const { fetchGateway } = jest.requireMock('@/app/api/_lib/gateway') as { fetchGateway: jest.Mock };

const upstream = (body: unknown): Response =>
  ({
    ok: true,
    status: 200,
    headers: new Headers({ 'cache-control': 'public, max-age=60' }),
    json: () => Promise.resolve(body),
  }) as unknown as Response;

const ID = '00000000-0000-4000-8000-000000000001';

describe('GET /api/listings/by-ids (#76)', () => {
  beforeEach(() => clearListingsReadCache());
  afterEach(() => fetchGateway.mockReset());

  it('relays only the ids parameter to the gateway and drops any other', async () => {
    fetchGateway.mockResolvedValue(upstream({ results: [] }));

    const res = await GET(
      new NextRequest(`http://localhost/api/listings/by-ids?ids=${ID}&fields=id`),
    );

    expect(res.status).toBe(200);
    const [path] = fetchGateway.mock.calls[0] as [string];
    expect(path).toBe(`/property/listings/by-ids?ids=${ID}`);
  });
});
