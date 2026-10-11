/** @jest-environment node */
import { NextRequest } from 'next/server';
import { fetchGatewayAsUser } from '@/app/api/_lib/authed-gateway';
import { GET } from './route';
import { DELETE, PUT } from './[id]/route';

jest.mock('@/app/api/_lib/authed-gateway');
const mockedFetch = fetchGatewayAsUser as jest.Mock;

const ID = '3f2c1b9e-5a7d-4c1e-9b0a-1d2e3f4a5b6c';
const req = (body?: unknown) =>
  new NextRequest('http://localhost/api/looking-for', {
    method: body === undefined ? 'GET' : 'PUT',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe('looking-for routes', () => {
  afterEach(() => jest.resetAllMocks());

  it('GET passes the upstream status through on failure', async () => {
    mockedFetch.mockResolvedValue(new Response(null, { status: 401 }));
    expect((await GET(req())).status).toBe(401);
  });

  it('PUT forwards only the known fields', async () => {
    mockedFetch.mockResolvedValue(Response.json({ id: ID }, { status: 201 }));
    const res = await PUT(req({ intent: 'buy', places: [], notes: 'x' }), ctx(ID));
    expect(res.status).toBe(201);
    expect(mockedFetch).toHaveBeenCalledWith(expect.anything(), `/property/looking-for/${ID}`, {
      method: 'PUT',
      body: { intent: 'buy', places: [] },
    });
  });

  it('PUT passes validation errors through', async () => {
    mockedFetch.mockResolvedValue(
      Response.json(
        {
          error: {
            code: 'invalid_request',
            message: 'Invalid field(s): intent.',
            fields: ['intent'],
          },
        },
        { status: 400 },
      ),
    );
    const res = await PUT(req({ intent: 'x' }), ctx(ID));
    expect(res.status).toBe(400);
    expect((await res.json()).fields).toEqual(['intent']);
  });

  it('PUT names the limit on a 409', async () => {
    mockedFetch.mockResolvedValue(
      Response.json({ error: { code: 'conflict', message: 'x' } }, { status: 409 }),
    );
    const res = await PUT(req({ intent: 'buy' }), ctx(ID));
    expect((await res.json()).error).toBe('limit_reached');
  });

  it('rejects an id that is not a GUID', async () => {
    expect((await PUT(req({}), ctx('abc'))).status).toBe(400);
    expect((await DELETE(req(), ctx('../profile'))).status).toBe(400);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('DELETE answers 204', async () => {
    mockedFetch.mockResolvedValue(new Response(null, { status: 204 }));
    expect((await DELETE(req(), ctx(ID))).status).toBe(204);
  });
});
