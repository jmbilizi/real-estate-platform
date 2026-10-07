/** @jest-environment node */
import { NextRequest } from 'next/server';
import { fetchGateway } from '@/app/api/_lib/gateway';
import { POST as emailStart } from './email/change/start/route';
import { POST as emailVerify } from './email/change/verify/route';
import { POST as passwordChange } from './password/change/route';

jest.mock('@/app/api/_lib/gateway');
jest.mock('@/app/api/_lib/refresh', () => ({ tryRefreshToken: jest.fn().mockResolvedValue(null) }));
const mockedFetch = fetchGateway as jest.Mock;

const SESSION = encodeURIComponent(JSON.stringify({ email: 'old@example.com' }));
const req = (body: unknown, signedIn = true) =>
  new NextRequest('http://localhost/api/account/x', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: signedIn ? { cookie: `access_token=tok; session=${SESSION}` } : {},
  });
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

describe('change email and change password routes', () => {
  afterEach(() => jest.resetAllMocks());

  it('email start sends the bearer token and forwards stepUp and timing only', async () => {
    mockedFetch.mockResolvedValue(
      json({ stepUp: 'oldEmailCode', resendAfterSeconds: 30, expiresInSeconds: 600, extra: 'x' }),
    );
    const res = await emailStart(req({ newEmail: ' new@example.com ' }));

    expect(mockedFetch.mock.calls[0][0]).toBe('/account/email/change/start');
    expect(mockedFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(mockedFetch.mock.calls[0][1].body)).toEqual({ newEmail: 'new@example.com' });
    expect(await res.json()).toEqual({
      stepUp: 'oldEmailCode',
      resendAfterSeconds: 30,
      expiresInSeconds: 600,
    });
  });

  it('email start passes the password untrimmed and keeps the 429 Retry-After', async () => {
    mockedFetch.mockResolvedValue(json({}, 429, { 'Retry-After': '90' }));
    const res = await emailStart(req({ newEmail: 'n@e.co', currentPassword: ' pw ' }));

    expect(JSON.parse(mockedFetch.mock.calls[0][1].body).currentPassword).toBe(' pw ');
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('90');
  });

  it('answers 401 with no gateway call when signed out', async () => {
    const res = await emailStart(req({ newEmail: 'n@e.co' }, false));
    expect(res.status).toBe(401);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('email verify sets the new cookies from the bearer body and reads the new address', async () => {
    mockedFetch
      .mockResolvedValueOnce(json({ accessToken: 'new', refreshToken: 'r', expiresIn: 3600 }))
      .mockResolvedValueOnce(json({ email: 'new@example.com' }));
    const res = await emailVerify(req({ code: '123456' }));

    expect(res.cookies.get('access_token')?.value).toBe('new');
    expect(res.cookies.get('session')?.value).toContain('new@example.com');
    expect(await res.json()).toMatchObject({ email: 'new@example.com', accessToken: 'new' });
  });

  it('email verify falls back to the typed address when the account read fails', async () => {
    mockedFetch
      .mockResolvedValueOnce(json({ accessToken: 'new', expiresIn: 3600 }))
      .mockResolvedValueOnce(json({}, 500));
    const res = await emailVerify(req({ code: '123456', newEmail: 'new@example.com' }));

    expect(await res.json()).toMatchObject({ email: 'new@example.com' });
    expect(res.cookies.get('session')?.value).toContain('new@example.com');
  });

  it('email verify passes a wrong code through with the tries left', async () => {
    mockedFetch.mockResolvedValue(json({ error: 'invalid_code', attemptsLeft: 2 }, 400));
    const res = await emailVerify(req({ code: '123456' }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_code', attemptsLeft: 2 });
    expect(res.cookies.get('access_token')).toBeUndefined();
  });

  it('password change posts oldPassword and newPassword to manage/info and re-issues cookies', async () => {
    mockedFetch.mockResolvedValue(json({ accessToken: 'new', expiresIn: 3600 }));
    const res = await passwordChange(req({ currentPassword: 'old pw', newPassword: 'new pw' }));

    expect(mockedFetch.mock.calls[0][0]).toBe('/account/manage/info');
    expect(JSON.parse(mockedFetch.mock.calls[0][1].body)).toEqual({
      oldPassword: 'old pw',
      newPassword: 'new pw',
    });
    expect(res.cookies.get('access_token')?.value).toBe('new');
    expect(await res.json()).toMatchObject({ email: 'old@example.com' });
  });

  it.each([
    [{ PasswordMismatch: ['Incorrect password.'] }, { error: 'wrong_password' }],
    [{ breached: ['x'] }, { error: 'password_rejected', errors: ['breached'] }],
  ])('password change maps the validation problem %j', async (errors, expected) => {
    mockedFetch.mockResolvedValue(json({ errors }, 400));
    const res = await passwordChange(req({ currentPassword: 'a', newPassword: 'b' }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(expected);
    expect(res.cookies.get('access_token')).toBeUndefined();
  });

  it('password change keeps the 429 Retry-After', async () => {
    mockedFetch.mockResolvedValue(json({ error: 'limited' }, 429, { 'Retry-After': '300' }));
    const res = await passwordChange(req({ currentPassword: 'a', newPassword: 'b' }));

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('300');
  });
});
