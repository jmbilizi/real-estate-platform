/** @jest-environment node */
import { NextRequest } from 'next/server';
import { fetchGateway } from '@/app/api/_lib/gateway';
import { POST as login } from '../route';
import { POST as verify } from './route';
import { POST as resend } from './resend/route';
import { GET as getSetting, PUT as putSetting } from '../../security/new-device/route';

jest.mock('@/app/api/_lib/gateway');
jest.mock('@/app/api/_lib/refresh', () => ({ tryRefreshToken: jest.fn().mockResolvedValue(null) }));
const mockedFetch = fetchGateway as jest.Mock;

const TOKEN = `${'a'.repeat(43)}.${'b'.repeat(43)}`;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest('http://localhost/api/account/x', {
    method: 'POST',
    body: JSON.stringify(body),
    headers,
  });
const authed = (method: string, body?: unknown, extra: Record<string, string> = {}) =>
  new NextRequest('http://localhost/api/account/security/new-device', {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { cookie: 'access_token=tok', ...extra },
  });

describe('new device sign-in routes', () => {
  afterEach(() => jest.resetAllMocks());

  it('login answers 202 with the code timing when the account asks for a code', async () => {
    mockedFetch.mockResolvedValue(
      json(
        {
          error: 'device_code_required',
          resendAfterSeconds: 60,
          expiresInSeconds: 600,
          reason: null,
        },
        401,
      ),
    );

    const res = await login(post({ email: 'a@b.co', password: 'pw' }));

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({
      deviceCodeRequired: true,
      resendAfterSeconds: 60,
      expiresInSeconds: 600,
      sent: true,
    });
    expect(res.cookies.get('access_token')).toBeUndefined();
  });

  it('login passes a not-sent reason through, and a plain 401 stays a 401', async () => {
    mockedFetch.mockResolvedValueOnce(
      json(
        {
          error: 'device_code_required',
          resendAfterSeconds: 90,
          expiresInSeconds: 0,
          reason: 'cooldown',
        },
        401,
      ),
    );
    expect(await (await login(post({ email: 'a@b.co', password: 'pw' }))).json()).toMatchObject({
      sent: false,
      reason: 'cooldown',
    });

    mockedFetch.mockResolvedValueOnce(json({ title: 'Failed' }, 401));
    expect((await login(post({ email: 'a@b.co', password: 'pw' }))).status).toBe(401);
  });

  it('login sends the device cookie and a short label, never the raw user agent', async () => {
    mockedFetch.mockResolvedValue(json({}, 401));

    await login(
      post(
        { email: 'a@b.co', password: 'pw' },
        {
          cookie: `device_token=${TOKEN}`,
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36',
        },
      ),
    );

    const headers = mockedFetch.mock.calls[0][1].headers;
    expect(headers['X-Device-Token']).toBe(TOKEN);
    expect(headers['X-Device-Label']).toBe('Chrome on Windows');
  });

  it('verify sets the session cookies and an httpOnly device cookie with the service life', async () => {
    mockedFetch.mockResolvedValue(
      json({ accessToken: 'at', refreshToken: 'rt', expiresIn: 3600 }, 200, {
        'X-Device-Token-Issued': TOKEN,
        'X-Device-Max-Age': '2592000',
      }),
    );

    const res = await verify(post({ email: 'a@b.co', password: ' pw ', code: '123456' }));

    expect(JSON.parse(mockedFetch.mock.calls[0][1].body)).toEqual({
      email: 'a@b.co',
      password: ' pw ',
      code: '123456',
    });
    expect(res.cookies.get('access_token')?.value).toBe('at');
    const device = res.cookies.get('device_token');
    expect(device?.value).toBe(TOKEN);
    expect(device).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/', maxAge: 2592000 });
  });

  it('verify sets no device cookie for a malformed token', async () => {
    mockedFetch.mockResolvedValue(
      json({ accessToken: 'at', expiresIn: 3600 }, 200, {
        'X-Device-Token-Issued': 'bad token;',
        'X-Device-Max-Age': '2592000',
      }),
    );

    const res = await verify(post({ email: 'a@b.co', password: 'pw', code: '123456' }));

    expect(res.cookies.get('device_token')).toBeUndefined();
  });

  it('verify forwards a wrong code with the tries left, and a lock with Retry-After', async () => {
    mockedFetch.mockResolvedValueOnce(json({ error: 'invalid_code', attemptsLeft: 2 }, 400));
    const wrong = await verify(post({ email: 'a@b.co', password: 'pw', code: '000000' }));
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toEqual({ error: 'invalid_code', attemptsLeft: 2 });

    mockedFetch.mockResolvedValueOnce(json({}, 429, { 'Retry-After': '300' }));
    const locked = await verify(post({ email: 'a@b.co', password: 'pw', code: '000000' }));
    expect(locked.status).toBe(429);
    expect(locked.headers.get('Retry-After')).toBe('300');
  });

  it('verify and resend refuse a missing field with no gateway call', async () => {
    expect((await verify(post({ email: 'a@b.co', password: 'pw' }))).status).toBe(400);
    expect((await resend(post({ email: 'a@b.co' }))).status).toBe(400);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('resend maps the answer to the code timing', async () => {
    mockedFetch.mockResolvedValue(
      json({ resendAfterSeconds: 60, expiresInSeconds: 600, reason: null }),
    );

    const res = await resend(post({ email: 'a@b.co', password: 'pw' }));

    expect(await res.json()).toEqual({ resendAfterSeconds: 60, expiresInSeconds: 600, sent: true });
  });

  it('the setting GET forwards only known fields and marks the current device', async () => {
    mockedFetch.mockResolvedValue(
      json({
        enabled: true,
        secret: 'x',
        devices: [
          {
            id: 'i',
            label: 'Chrome on Windows',
            firstSeenAt: 'f',
            lastUsedAt: 'l',
            current: true,
            hash: 'h',
          },
        ],
      }),
    );

    const res = await getSetting(
      authed('GET', undefined, { cookie: `access_token=tok; device_token=${TOKEN}` }),
    );

    expect(mockedFetch.mock.calls[0][1].headers['X-Device-Token']).toBe(TOKEN);
    expect(await res.json()).toEqual({
      enabled: true,
      devices: [
        { id: 'i', label: 'Chrome on Windows', firstSeenAt: 'f', lastUsedAt: 'l', current: true },
      ],
    });
  });

  it('the setting PUT needs a password, sends it untrimmed, and trusts this browser when turned on', async () => {
    expect((await putSetting(authed('PUT', { enabled: true }))).status).toBe(400);
    expect(mockedFetch).not.toHaveBeenCalled();

    mockedFetch.mockResolvedValue(
      json({ enabled: true }, 200, {
        'X-Device-Token-Issued': TOKEN,
        'X-Device-Max-Age': '2592000',
      }),
    );
    const res = await putSetting(authed('PUT', { enabled: true, currentPassword: ' pw ' }));

    expect(JSON.parse(mockedFetch.mock.calls[0][1].body)).toEqual({
      enabled: true,
      currentPassword: ' pw ',
    });
    expect(await res.json()).toEqual({ enabled: true });
    expect(res.cookies.get('device_token')?.value).toBe(TOKEN);
  });

  it('the setting PUT forwards a wrong password as 403', async () => {
    mockedFetch.mockResolvedValue(json({ error: 'step_up_failed' }, 403));

    const res = await putSetting(authed('PUT', { enabled: false, currentPassword: 'bad' }));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'step_up_failed' });
  });

  it('the setting routes answer 401 with no gateway call when signed out', async () => {
    const res = await getSetting(
      new NextRequest('http://localhost/api/account/security/new-device'),
    );
    expect(res.status).toBe(401);
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});
