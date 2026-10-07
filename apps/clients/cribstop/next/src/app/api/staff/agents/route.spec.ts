/** @jest-environment node */
import { NextRequest } from 'next/server';
import { GET, POST } from './route';
import { PATCH } from './[id]/route';
import { POST as ASSIGN } from '../leads/[id]/assign/route';
import { POST as UNASSIGN } from '../leads/[id]/unassign/route';
import { fetchGatewayAsUser } from '@/app/api/_lib/authed-gateway';

jest.mock('@/app/api/_lib/authed-gateway', () => ({ fetchGatewayAsUser: jest.fn() }));
const gateway = fetchGatewayAsUser as jest.Mock;

const ctx = { params: Promise.resolve({ id: 'abc' }) };
const send = (body: unknown) =>
  new NextRequest('http://localhost/x', { method: 'POST', body: JSON.stringify(body) });
beforeEach(() => gateway.mockReset().mockResolvedValue(new Response('{}', { status: 200 })));

it('GET forwards only the contract filters', async () => {
  await GET(new NextRequest('http://localhost/api/staff/agents?active=true&licenceState=MD&x=1'));
  expect(gateway.mock.calls[0][1]).toBe('/property/staff/agents?active=true&licenceState=MD');
});

it('POST rebuilds the create body from contract keys', async () => {
  await POST(
    send({
      accountId: 'a',
      displayName: 'D',
      licenceNumber: 'L',
      licenceStates: ['MD'],
      role: 'Admin',
    }),
  );
  expect(gateway.mock.calls[0][2].body).toEqual({
    accountId: 'a',
    displayName: 'D',
    licenceNumber: 'L',
    licenceStates: ['MD'],
  });
});

it('PATCH rebuilds the body and drops the account', async () => {
  await PATCH(send({ active: false, accountId: 'x' }), ctx);
  const [path, init] = gateway.mock.calls[0].slice(1);
  expect(path).toBe('/property/staff/agents/abc');
  expect(init).toEqual({ method: 'PATCH', body: { active: false } });
});

it('assign sends only the agent id', async () => {
  await ASSIGN(send({ agentProfileId: 'p1', reason: 'extra' }), ctx);
  const [path, init] = gateway.mock.calls[0].slice(1);
  expect(path).toBe('/property/staff/leads/abc/assign');
  expect(init.body).toEqual({ agentProfileId: 'p1' });
});

it('unassign sends only the note', async () => {
  await UNASSIGN(send({ note: 'moved', extra: 1 }), ctx);
  expect(gateway.mock.calls[0][2].body).toEqual({ note: 'moved' });
});

it('assign and unassign refuse a malformed body without calling the gateway', async () => {
  expect((await ASSIGN(send({}), ctx)).status).toBe(400);
  expect((await UNASSIGN(send({ note: 5 }), ctx)).status).toBe(400);
  expect(gateway).not.toHaveBeenCalled();
});
