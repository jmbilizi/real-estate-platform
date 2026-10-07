/** @jest-environment node */
import { loadStaffRoles } from './staff-server';
import { fetchGateway } from '@/app/api/_lib/gateway';
import { cookies } from 'next/headers';

jest.mock('@/app/api/_lib/gateway', () => ({ fetchGateway: jest.fn() }));
jest.mock('next/headers', () => ({ cookies: jest.fn() }));

const gateway = fetchGateway as jest.Mock;
const jar = (token?: string) =>
  (cookies as jest.Mock).mockResolvedValue({
    get: () => (token ? { value: token } : undefined),
  });

beforeEach(() => gateway.mockReset());

it('returns no roles and makes no call without a session', async () => {
  jar();
  expect(await loadStaffRoles()).toEqual([]);
  expect(gateway).not.toHaveBeenCalled();
});

it('returns the roles of the caller', async () => {
  jar('tok');
  gateway.mockResolvedValue(new Response(JSON.stringify({ roles: ['User', 'Moderator'] })));
  expect(await loadStaffRoles()).toEqual(['User', 'Moderator']);
  expect(gateway.mock.calls[0][0]).toBe('/property/staff/me');
  expect(gateway.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
});

it.each([
  ['an error status', () => new Response('{}', { status: 401 })],
  ['a malformed body', () => new Response(JSON.stringify({ nope: 1 }))],
  ['an unreadable body', () => new Response('not json')],
])('closes the gate on %s', async (_n, make) => {
  jar('tok');
  gateway.mockResolvedValue(make());
  expect(await loadStaffRoles()).toEqual([]);
});

it('closes the gate when the gateway is down', async () => {
  jar('tok');
  gateway.mockRejectedValue(new Error('down'));
  expect(await loadStaffRoles()).toEqual([]);
});
