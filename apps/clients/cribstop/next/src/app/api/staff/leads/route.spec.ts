/** @jest-environment node */
import { NextRequest } from 'next/server';
import { GET } from './route';
import { GET as GET_ONE } from './[id]/route';
import { POST as TRANSITION } from './[id]/transition/route';
import { POST as NOTE } from './[id]/notes/route';
import { fetchGatewayAsUser } from '@/app/api/_lib/authed-gateway';

jest.mock('@/app/api/_lib/authed-gateway', () => ({ fetchGatewayAsUser: jest.fn() }));
const gateway = fetchGatewayAsUser as jest.Mock;

const ctx = { params: Promise.resolve({ id: 'abc' }) };
const post = (body: unknown) =>
  new NextRequest('http://localhost/x', { method: 'POST', body: JSON.stringify(body) });
const reply = (body: unknown, status = 200) =>
  gateway.mockResolvedValue(new Response(JSON.stringify(body), { status }));

beforeEach(() => gateway.mockReset());

describe('GET /api/staff/leads', () => {
  it('forwards only contract parameters', async () => {
    reply({ results: [], nextCursor: null });
    const res = await GET(
      new NextRequest('http://localhost/api/staff/leads?status=new&cursor=c1&email=a@b.co&x=1'),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const [path, init] = gateway.mock.calls[0].slice(1);
    expect(path).toBe('/property/staff/leads?status=new&cursor=c1');
    expect(init.method).toBe('GET');
  });

  it('passes an upstream refusal through', async () => {
    reply({ error: { code: 'forbidden', message: 'no' } }, 403);
    const res = await GET(new NextRequest('http://localhost/api/staff/leads'));
    expect(res.status).toBe(403);
  });
});

it('GET one reads the lead', async () => {
  reply({ id: 'abc' });
  await GET_ONE(new NextRequest('http://localhost/x'), ctx);
  expect(gateway.mock.calls[0][1]).toBe('/property/staff/leads/abc');
});

describe('POST transition', () => {
  it('rebuilds the body from `to` and `note`', async () => {
    reply({ id: 'abc', from: 'new', to: 'spam' });
    await TRANSITION(post({ to: 'spam', note: 'bot', actorRole: 'Admin' }), ctx);
    const [path, init] = gateway.mock.calls[0].slice(1);
    expect(path).toBe('/property/staff/leads/abc/transition');
    expect(init.body).toEqual({ to: 'spam', note: 'bot' });
  });

  it('rejects an unknown status without calling the gateway', async () => {
    const res = await TRANSITION(post({ to: 'purple' }), ctx);
    expect(res.status).toBe(400);
    expect(gateway).not.toHaveBeenCalled();
  });

  it('passes the 409 message through', async () => {
    reply({ error: { code: 'conflict', message: 'Invalid transition.' } }, 409);
    const res = await TRANSITION(post({ to: 'verified' }), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toBe('Invalid transition.');
  });
});

describe('POST notes', () => {
  it('forwards the note body only', async () => {
    reply({ id: 'n1' }, 201);
    const res = await NOTE(post({ body: 'called', extra: 1 }), ctx);
    expect(res.status).toBe(201);
    expect(gateway.mock.calls[0][2].body).toEqual({ body: 'called' });
  });

  it('rejects a non-text body', async () => {
    const res = await NOTE(post({ body: 5 }), ctx);
    expect(res.status).toBe(400);
    expect(gateway).not.toHaveBeenCalled();
  });
});
