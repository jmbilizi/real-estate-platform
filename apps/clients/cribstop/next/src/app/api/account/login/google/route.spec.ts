/** @jest-environment node */
import { NextRequest } from 'next/server';
import { fetchGateway } from '@/app/api/_lib/gateway';
import { POST } from './route';

jest.mock('@/app/api/_lib/gateway');
const mockedFetch = fetchGateway as jest.Mock;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const post = (body: unknown) =>
  new NextRequest('http://localhost/api/account/login/google', {
    method: 'POST',
    body: JSON.stringify(body),
  });

describe('POST /api/account/login/google', () => {
  afterEach(() => jest.resetAllMocks());

  it('answers 400 with no credential and calls no upstream', async () => {
    const res = await POST(post({}));

    expect(res.status).toBe(400);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('sets the session cookies, with the email from manage/info', async () => {
    mockedFetch
      .mockResolvedValueOnce(json({ accessToken: 'at', refreshToken: 'rt', expiresIn: 3600 }))
      .mockResolvedValueOnce(json({ email: 'a@b.co' }));

    const res = await POST(post({ credential: 'id-token' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: 'a@b.co', accessToken: 'at', expiresIn: 3600 });
    expect(res.cookies.get('access_token')?.value).toBe('at');
    expect(res.cookies.get('refresh_token')?.value).toBe('rt');
    expect(res.cookies.get('session')?.value).toContain('a@b.co');
    const [path, init] = mockedFetch.mock.calls[0];
    expect(path).toBe('/account/login/google');
    expect(JSON.parse(init.body)).toEqual({ credential: 'id-token' });
    expect(mockedFetch.mock.calls[1][1].headers.Authorization).toBe('Bearer at');
  });

  it('relays a 401 and sets no cookie', async () => {
    mockedFetch.mockResolvedValue(json({ error: 'invalid_token' }, 401));

    const res = await POST(post({ credential: 'bad' }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'invalid_token' });
    expect(res.cookies.get('access_token')).toBeUndefined();
  });

  it('relays a 503 when Google sign-in is off', async () => {
    mockedFetch.mockResolvedValue(json({ error: 'google_unavailable' }, 503));

    expect((await POST(post({ credential: 'x' }))).status).toBe(503);
  });

  it('answers 503 when the gateway does not answer', async () => {
    mockedFetch.mockRejectedValue(new Error('down'));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    expect((await POST(post({ credential: 'x' }))).status).toBe(503);
  });
});
