/** @jest-environment node */
import { NextRequest } from 'next/server';
import { fetchGatewayAsUser } from '@/app/api/_lib/authed-gateway';
import { GET, POST } from './route';
import { DELETE } from './[interest]/route';

jest.mock('@/app/api/_lib/authed-gateway');
const mockedFetch = fetchGatewayAsUser as jest.Mock;

const req = (body?: unknown) =>
  new NextRequest('http://localhost/api/account/waitlist', {
    method: body === undefined ? 'GET' : 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe('waitlist routes', () => {
  afterEach(() => jest.resetAllMocks());

  it('POST forwards only the interest kind', async () => {
    mockedFetch.mockResolvedValue(new Response(null, { status: 204 }));
    const res = await POST(req({ interest: 'connect', email: 'x@example.com' }));
    expect(res.status).toBe(204);
    expect(mockedFetch).toHaveBeenCalledWith(expect.anything(), '/account/waitlist', {
      method: 'POST',
      body: { interest: 'connect' },
    });
  });

  it('POST rejects a body with no interest', async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('GET passes the upstream status through on failure', async () => {
    mockedFetch.mockResolvedValue(new Response(null, { status: 401 }));
    expect((await GET(req())).status).toBe(401);
  });

  it('DELETE encodes the interest in the gateway path', async () => {
    mockedFetch.mockResolvedValue(new Response(null, { status: 204 }));
    const res = await DELETE(req(), { params: Promise.resolve({ interest: 'connect' }) });
    expect(res.status).toBe(204);
    expect(mockedFetch).toHaveBeenCalledWith(expect.anything(), '/account/waitlist/connect', {
      method: 'DELETE',
    });
  });
});
