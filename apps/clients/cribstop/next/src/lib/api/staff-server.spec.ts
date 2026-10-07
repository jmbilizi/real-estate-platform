/** @jest-environment node */
import { loadStaffGate } from './staff-server';
import { fetchGateway } from '@/app/api/_lib/gateway';
import { cookies } from 'next/headers';

jest.mock('@/app/api/_lib/gateway', () => ({ fetchGateway: jest.fn() }));
jest.mock('next/headers', () => ({ cookies: jest.fn() }));

const gateway = fetchGateway as jest.Mock;
const jar = (values: Record<string, string>) =>
  (cookies as jest.Mock).mockResolvedValue({
    get: (n: string) => (n in values ? { value: values[n] } : undefined),
    has: (n: string) => n in values,
  });

beforeEach(() => gateway.mockReset());

it('closes the gate with no refresh for an anonymous caller', async () => {
  jar({});
  expect(await loadStaffGate()).toEqual({ roles: [], canRefresh: false });
  expect(gateway).not.toHaveBeenCalled();
});

it('offers a refresh when the access token is gone but a refresh token exists', async () => {
  jar({ refresh_token: 'r' });
  expect(await loadStaffGate()).toEqual({ roles: [], canRefresh: true });
});

it('offers a refresh on a 401, once', async () => {
  jar({ access_token: 'old', refresh_token: 'r' });
  gateway.mockResolvedValue(new Response('{}', { status: 401 }));
  expect((await loadStaffGate()).canRefresh).toBe(true);

  jar({ access_token: 'old', refresh_token: 'r', staff_refresh_try: '1' });
  gateway.mockResolvedValue(new Response('{}', { status: 401 }));
  expect((await loadStaffGate()).canRefresh).toBe(false);
});

it('returns the roles of the caller', async () => {
  jar({ access_token: 'tok' });
  gateway.mockResolvedValue(new Response(JSON.stringify({ roles: ['User', 'Moderator'] })));
  expect(await loadStaffGate()).toEqual({ roles: ['User', 'Moderator'], canRefresh: false });
  expect(gateway.mock.calls[0][0]).toBe('/property/staff/me');
  expect(gateway.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
});

it.each([
  ['an error status', () => new Response('{}', { status: 500 })],
  ['a malformed body', () => new Response(JSON.stringify({ nope: 1 }))],
  ['an unreadable body', () => new Response('not json')],
])('closes the gate on %s', async (_n, make) => {
  jar({ access_token: 'tok', refresh_token: 'r' });
  gateway.mockResolvedValue(make());
  expect(await loadStaffGate()).toEqual({ roles: [], canRefresh: false });
});

it('closes the gate when the gateway is down', async () => {
  jar({ access_token: 'tok' });
  gateway.mockRejectedValue(new Error('down'));
  expect((await loadStaffGate()).roles).toEqual([]);
});
