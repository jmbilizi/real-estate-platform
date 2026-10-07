/** @jest-environment node */
import { loadAgentGate } from './agent-server';
import { loadStaffGate } from './staff-server';
import { fetchGateway } from '@/app/api/_lib/gateway';
import { cookies } from 'next/headers';

jest.mock('./staff-server', () => ({ loadStaffGate: jest.fn() }));
jest.mock('@/app/api/_lib/gateway', () => ({ fetchGateway: jest.fn() }));
jest.mock('next/headers', () => ({ cookies: jest.fn() }));

const staff = loadStaffGate as jest.Mock;
const gateway = fetchGateway as jest.Mock;

beforeEach(() => {
  staff.mockReset();
  gateway.mockReset();
  (cookies as jest.Mock).mockResolvedValue({ get: () => ({ value: 'tok' }) });
});

it('closes the gate without the Agent role, without a probe', async () => {
  staff.mockResolvedValue({ roles: ['User', 'Admin'], canRefresh: false });
  expect(await loadAgentGate()).toEqual({ allowed: false, canRefresh: false });
  expect(gateway).not.toHaveBeenCalled();
});

it('keeps the refresh hint from the staff gate', async () => {
  staff.mockResolvedValue({ roles: [], canRefresh: true });
  expect(await loadAgentGate()).toEqual({ allowed: false, canRefresh: true });
});

it('opens for the Agent role with an active profile', async () => {
  staff.mockResolvedValue({ roles: ['User', 'Agent'], canRefresh: false });
  gateway.mockResolvedValue(new Response('{"results":[]}'));
  expect(await loadAgentGate()).toEqual({ allowed: true, canRefresh: false });
  expect(gateway.mock.calls[0][0]).toBe('/property/agent/leads?status=lost');
  expect(gateway.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
});

it.each([
  ['no active profile (403)', () => Promise.resolve(new Response('{}', { status: 403 }))],
  ['a service error', () => Promise.resolve(new Response('{}', { status: 500 }))],
  ['a down gateway', () => Promise.reject(new Error('down'))],
])('closes the gate on %s', async (_n, make) => {
  staff.mockResolvedValue({ roles: ['Agent'], canRefresh: false });
  gateway.mockImplementation(make);
  expect((await loadAgentGate()).allowed).toBe(false);
});
