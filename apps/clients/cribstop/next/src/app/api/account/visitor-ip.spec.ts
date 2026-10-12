/** @jest-environment node */
import { NextRequest } from 'next/server';
import { fetchGateway } from '@/app/api/_lib/gateway';
import { POST as identify } from './identify/route';
import { POST as login } from './login/route';
import { POST as signupVerify } from './signup/verify/route';
import { POST as signupComplete } from './signup/complete/route';
import { POST as resetStart } from './password/reset/start/route';
import { POST as emailStart } from './email/change/start/route';
import { POST as passwordChange } from './password/change/route';

jest.mock('@/app/api/_lib/gateway');
jest.mock('@/app/api/_lib/refresh', () => ({ tryRefreshToken: jest.fn().mockResolvedValue(null) }));
const mockedFetch = fetchGateway as jest.Mock;

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest('http://localhost/api/account/x', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { cookie: 'access_token=tok', ...headers },
  });

const sentHeaders = () => mockedFetch.mock.calls[0][1].headers as Record<string, string>;

describe('account relay forwards the visitor IP (#811)', () => {
  beforeEach(() => {
    mockedFetch.mockResolvedValue(
      new Response(JSON.stringify({ next: 'code', sent: true }), { status: 200 }),
    );
  });
  afterEach(() => jest.resetAllMocks());

  const routes: Array<[string, (req: NextRequest) => Promise<Response>, unknown]> = [
    ['identify', identify, { email: 'a@example.com' }],
    ['signup verify', signupVerify, { email: 'a@example.com', code: '123456' }],
    [
      'signup complete',
      signupComplete,
      { email: 'a@example.com', signupProof: 'p', password: 'x' },
    ],
    ['password reset start', resetStart, { email: 'a@example.com' }],
    ['login', login, { email: 'a@example.com', password: 'x' }],
    ['email change start', emailStart, { newEmail: 'b@example.com' }],
    ['password change', passwordChange, { currentPassword: 'a', newPassword: 'b' }],
  ];

  it.each(routes)('%s sends the first X-Forwarded-For address', async (_name, route, body) => {
    await route(post(body, { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }));

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(sentHeaders()['X-Forwarded-For']).toBe('203.0.113.9');
  });

  it.each(routes)('%s sends no header for a value that is not an IP', async (_n, route, body) => {
    await route(post(body, { 'x-forwarded-for': 'not-an-ip, 203.0.113.9' }));

    expect(sentHeaders()['X-Forwarded-For']).toBeUndefined();
  });

  it('forwards an IPv6 address', async () => {
    await identify(post({ email: 'a@example.com' }, { 'x-forwarded-for': '2001:db8::1' }));

    expect(sentHeaders()['X-Forwarded-For']).toBe('2001:db8::1');
  });

  it('forwards the new sent field to the browser', async () => {
    mockedFetch.mockResolvedValue(
      new Response(JSON.stringify({ next: 'code', sent: false, resendAfterSeconds: 42 }), {
        status: 200,
      }),
    );
    const res = await identify(post({ email: 'a@example.com' }));

    expect(await res.json()).toEqual({ next: 'code', sent: false, resendAfterSeconds: 42 });
  });
});
