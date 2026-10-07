/** @jest-environment node */
import { fetchGateway } from '@/app/api/_lib/gateway';
import { POST as start } from './start/route';
import { POST as verify } from './verify/route';
import { POST as complete } from './complete/route';

jest.mock('@/app/api/_lib/gateway');
const mockedFetch = fetchGateway as jest.Mock;

const req = (body: unknown) =>
  new Request('http://localhost/api/account/x', { method: 'POST', body: JSON.stringify(body) });
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

describe('password reset routes', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetAllMocks();
  });

  it('start forwards the email and the timing fields only', async () => {
    mockedFetch.mockResolvedValue(
      json({ resendAfterSeconds: 30, expiresInSeconds: 600, extra: 'x' }),
    );
    const res = await start(req({ email: ' a@b.co ' }));

    expect(mockedFetch.mock.calls[0][0]).toBe('/account/password/reset/start');
    expect(JSON.parse(mockedFetch.mock.calls[0][1].body)).toEqual({ email: 'a@b.co' });
    expect(await res.json()).toEqual({ resendAfterSeconds: 30, expiresInSeconds: 600 });
  });

  it('start rejects a missing email without calling the gateway', async () => {
    expect((await start(req({}))).status).toBe(400);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('start passes a 429 and its Retry-After through', async () => {
    mockedFetch.mockResolvedValue(json({}, 429, { 'Retry-After': '42' }));
    const res = await start(req({ email: 'a@b.co' }));

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('42');
  });

  it('start answers 503 when the gateway is down', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockedFetch.mockRejectedValue(new Error('down'));
    expect((await start(req({ email: 'a@b.co' }))).status).toBe(503);
  });

  it('verify returns the resetProof', async () => {
    mockedFetch.mockResolvedValue(json({ resetProof: 'rp', expiresInSeconds: 900 }));
    const res = await verify(req({ email: 'a@b.co', code: '123456' }));

    expect(mockedFetch.mock.calls[0][0]).toBe('/account/password/reset/verify');
    expect(await res.json()).toEqual({ resetProof: 'rp', expiresInSeconds: 900 });
  });

  it('verify passes a wrong code and the tries left through', async () => {
    mockedFetch.mockResolvedValue(json({ error: 'invalid_code', attemptsLeft: 3 }, 400));
    const res = await verify(req({ email: 'a@b.co', code: '000000' }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_code', attemptsLeft: 3 });
  });

  it('verify rejects a missing code', async () => {
    expect((await verify(req({ email: 'a@b.co' }))).status).toBe(400);
  });

  it('complete answers 204 with no body and no cookies', async () => {
    mockedFetch.mockResolvedValue(new Response(null, { status: 204 }));
    const res = await complete(req({ email: 'a@b.co', resetProof: 'rp', newPassword: ' pw ' }));

    expect(res.status).toBe(204);
    expect(res.cookies.getAll()).toHaveLength(0);
    expect(JSON.parse(mockedFetch.mock.calls[0][1].body)).toEqual({
      email: 'a@b.co',
      resetProof: 'rp',
      newPassword: ' pw ',
    });
  });

  it('complete passes the stable policy error codes through', async () => {
    mockedFetch.mockResolvedValue(
      json({ error: 'password_rejected', errors: ['too_short'], stack: 's' }, 400),
    );
    const res = await complete(req({ email: 'a@b.co', resetProof: 'rp', newPassword: 'x' }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'password_rejected', errors: ['too_short'] });
  });

  it('complete passes an invalid proof through', async () => {
    mockedFetch.mockResolvedValue(json({ error: 'invalid_proof' }, 401));
    const res = await complete(req({ email: 'a@b.co', resetProof: 'rp', newPassword: 'x' }));

    expect(res.status).toBe(401);
  });

  it('complete rejects a missing field', async () => {
    expect((await complete(req({ email: 'a@b.co', newPassword: 'x' }))).status).toBe(400);
  });
});
