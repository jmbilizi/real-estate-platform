/** @jest-environment node */
import { fetchGateway } from '@/app/api/_lib/gateway';
import { POST } from './route';
import { POST as identify } from '../../identify/route';
import { POST as verify } from '../verify/route';

jest.mock('@/app/api/_lib/gateway');
const mockedFetch = fetchGateway as jest.Mock;

const req = (body: unknown) =>
  new Request('http://localhost/api/account/x', { method: 'POST', body: JSON.stringify(body) });
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

describe('sign-up account routes', () => {
  afterEach(() => jest.resetAllMocks());

  it('complete sets the auth cookies from the bearer body', async () => {
    mockedFetch.mockResolvedValue(json({ accessToken: 'tok', expiresIn: 3600 }));
    const res = await POST(req({ email: 'a@b.co', signupProof: 'p', password: 'pw' }));

    expect(res.status).toBe(200);
    expect(mockedFetch.mock.calls[0][0]).toBe('/account/signup/complete');
    expect(JSON.parse(mockedFetch.mock.calls[0][1].body)).toEqual({
      email: 'a@b.co',
      signupProof: 'p',
      password: 'pw',
    });
    expect(res.cookies.get('access_token')?.value).toBe('tok');
    expect(await res.json()).toMatchObject({ email: 'a@b.co', accessToken: 'tok' });
  });

  it('complete passes the stable password error codes through, with no cookies', async () => {
    mockedFetch.mockResolvedValue(
      json({ error: 'password_rejected', errors: ['breached'], stack: 'secret' }, 400),
    );
    const res = await POST(req({ email: 'a@b.co', signupProof: 'p', password: 'pw' }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'password_rejected', errors: ['breached'] });
    expect(res.cookies.get('access_token')).toBeUndefined();
  });

  it.each([
    [401, 'invalid_proof'],
    [409, 'email_unavailable'],
  ])('complete passes %s through', async (status, error) => {
    mockedFetch.mockResolvedValue(json({ error }, status));
    const res = await POST(req({ email: 'a@b.co', signupProof: 'p', password: 'pw' }));
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error });
  });

  it('complete rejects a body with no proof', async () => {
    const res = await POST(req({ email: 'a@b.co', password: 'pw' }));
    expect(res.status).toBe(400);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('answers 503 when the gateway is unreachable', async () => {
    mockedFetch.mockRejectedValue(new Error('down'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect((await identify(req({ email: 'a@b.co' }))).status).toBe(503);
  });

  it('forwards Retry-After on a 429 from verify', async () => {
    mockedFetch.mockResolvedValue(json({}, 429, { 'Retry-After': '90' }));
    const res = await verify(req({ email: 'a@b.co', code: '123456' }));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('90');
  });

  it('verify forwards attemptsLeft on a wrong code', async () => {
    mockedFetch.mockResolvedValue(json({ error: 'invalid_code', attemptsLeft: 3 }, 400));
    const res = await verify(req({ email: 'a@b.co', code: '000000' }));
    expect(await res.json()).toEqual({ error: 'invalid_code', attemptsLeft: 3 });
  });

  it('identify forwards the next step and timing', async () => {
    mockedFetch.mockResolvedValue(
      json({ next: 'code', resendAfterSeconds: 30, expiresInSeconds: 600 }),
    );
    const res = await identify(req({ email: 'a@b.co' }));
    expect(await res.json()).toEqual({
      next: 'code',
      resendAfterSeconds: 30,
      expiresInSeconds: 600,
    });
  });
});
