/** @jest-environment node */
import { NextRequest } from 'next/server';
import { GET } from './route';
import { GET as GET_ONE } from './[id]/route';
import { POST as ACCEPT } from './[id]/accept/route';
import { POST as DECLINE } from './[id]/decline/route';
import { POST as STATUS } from './[id]/status/route';
import { fetchGatewayAsUser } from '@/app/api/_lib/authed-gateway';

jest.mock('@/app/api/_lib/authed-gateway', () => ({ fetchGatewayAsUser: jest.fn() }));
const gateway = fetchGatewayAsUser as jest.Mock;

const ctx = { params: Promise.resolve({ id: 'abc' }) };
const post = (body: unknown) =>
  new NextRequest('http://localhost/x', { method: 'POST', body: JSON.stringify(body) });
const reply = (body: unknown, status = 200) =>
  gateway.mockResolvedValue(new Response(JSON.stringify(body), { status }));

beforeEach(() => gateway.mockReset());

describe('GET /api/agent/leads', () => {
  it('lists through the agent namespace with no-store', async () => {
    reply({ results: [] });
    const res = await GET(new NextRequest('http://localhost/api/agent/leads?x=1'));
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(gateway.mock.calls[0][1]).toBe('/property/agent/leads');
  });

  it('forwards a valid status and rejects an invalid one', async () => {
    reply({ results: [] });
    await GET(new NextRequest('http://localhost/api/agent/leads?status=assigned'));
    expect(gateway.mock.calls[0][1]).toBe('/property/agent/leads?status=assigned');
    gateway.mockClear();
    const bad = await GET(new NextRequest('http://localhost/api/agent/leads?status=x'));
    expect(bad.status).toBe(400);
    expect(gateway).not.toHaveBeenCalled();
  });

  it('passes a 403 through', async () => {
    reply({ error: { code: 'forbidden', message: 'no' } }, 403);
    expect((await GET(new NextRequest('http://localhost/api/agent/leads'))).status).toBe(403);
  });
});

it('GET one reads the lead', async () => {
  reply({ id: 'abc' });
  await GET_ONE(new NextRequest('http://localhost/x'), ctx);
  expect(gateway.mock.calls[0][1]).toBe('/property/agent/leads/abc');
});

it('accept posts with no body', async () => {
  reply({ id: 'abc', from: 'assigned', to: 'accepted' });
  await ACCEPT(post({}), ctx);
  const [path, init] = gateway.mock.calls[0].slice(1);
  expect(path).toBe('/property/agent/leads/abc/accept');
  expect(init).toEqual({ method: 'POST' });
});

describe('decline', () => {
  it('forwards only the reason', async () => {
    reply({ id: 'abc', from: 'assigned', to: 'verified' });
    await DECLINE(post({ reason: 'no_capacity', extra: 1 }), ctx);
    expect(gateway.mock.calls[0][2].body).toEqual({ reason: 'no_capacity' });
  });

  it('rejects a reason outside the fixed list', async () => {
    const res = await DECLINE(post({ reason: 'buyer is too young' }), ctx);
    expect(res.status).toBe(400);
    expect(gateway).not.toHaveBeenCalled();
  });
});

describe('status', () => {
  it('rebuilds the body from `to` and `note`', async () => {
    reply({ id: 'abc', from: 'accepted', to: 'contacted' });
    await STATUS(post({ to: 'contacted', note: 'called', x: 1 }), ctx);
    expect(gateway.mock.calls[0][2].body).toEqual({ to: 'contacted', note: 'called' });
  });

  it.each([{ to: 'accepted' }, { to: 'verified' }, { to: 'contacted', note: 5 }, {}])(
    'rejects %j',
    async (body) => {
      expect((await STATUS(post(body), ctx)).status).toBe(400);
      expect(gateway).not.toHaveBeenCalled();
    },
  );

  it('passes the 409 through', async () => {
    reply({ error: { code: 'conflict', message: 'Invalid transition.' } }, 409);
    expect((await STATUS(post({ to: 'closed' }), ctx)).status).toBe(409);
  });
});
