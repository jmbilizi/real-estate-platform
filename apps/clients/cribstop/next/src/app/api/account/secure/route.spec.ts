/** @jest-environment node */
import { fetchGateway } from '@/app/api/_lib/gateway';
import { POST } from './route';

jest.mock('@/app/api/_lib/gateway');
const mockedFetch = fetchGateway as jest.Mock;

const req = (body: unknown) =>
  new Request('http://localhost/api/account/secure', {
    method: 'POST',
    body: JSON.stringify(body),
  });

describe('POST /api/account/secure', () => {
  afterEach(() => jest.resetAllMocks());

  it('forwards the token and relays only emailRestored', async () => {
    mockedFetch.mockResolvedValue(
      new Response(JSON.stringify({ emailRestored: true, email: 'x@example.com' }), {
        status: 200,
      }),
    );

    const res = await POST(req({ token: ' abc ' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ emailRestored: true });
    expect(mockedFetch).toHaveBeenCalledWith(
      '/account/secure',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ token: 'abc' }) }),
      expect.any(Number),
    );
  });

  it('rejects a body with no token without calling the gateway', async () => {
    const res = await POST(req({}));

    expect(res.status).toBe(400);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('passes a 400 from the service through', async () => {
    mockedFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid_token' }), { status: 400 }),
    );

    const res = await POST(req({ token: 'abc' }));

    expect(res.status).toBe(400);
  });
});
