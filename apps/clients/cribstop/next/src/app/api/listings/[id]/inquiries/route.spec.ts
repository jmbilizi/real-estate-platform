/** @jest-environment node */
import { NextRequest } from 'next/server';
import { POST } from './route';
import { fetchGateway } from '@/app/api/_lib/gateway';

jest.mock('@/app/api/_lib/gateway', () => ({ fetchGateway: jest.fn() }));
const mockFetch = fetchGateway as jest.Mock;

const ctx = { params: Promise.resolve({ id: 'abc' }) };
function request(body: unknown, cookie?: string) {
  return new NextRequest('http://localhost/api/listings/abc/inquiries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie && { cookie }) },
    body: JSON.stringify(body),
  });
}

beforeEach(() => mockFetch.mockReset());

describe('POST /api/listings/[id]/inquiries', () => {
  it('forwards an allowlisted body with the consent evidence', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ id: 'i1' }), { status: 201 }));
    const res = await POST(
      request(
        {
          kind: 'tour_request',
          name: 'Sam',
          email: 's@e.co',
          consentTextVersion: 'v1',
          consentChannels: ['email'],
          extra: 1,
        },
        'access_token=tok',
      ),
      ctx,
    );
    expect(res.status).toBe(201);
    const [path, init] = mockFetch.mock.calls[0];
    expect(path).toBe('/property/listings/abc/inquiries');
    expect(JSON.parse(init.body)).toEqual({
      kind: 'tour_request',
      name: 'Sam',
      email: 's@e.co',
      consentToContact: true,
      consentTextVersion: 'v1',
      consentChannels: ['email'],
    });
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('does not forward consent for an unknown version', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ id: 'i1' }), { status: 201 }));
    await POST(
      request({
        kind: 'message',
        name: 'S',
        email: 's@e.co',
        consentToContact: true,
        consentTextVersion: 'v9',
      }),
      ctx,
    );
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
      kind: 'message',
      name: 'S',
      email: 's@e.co',
    });
  });

  it('rejects malformed consent channels without calling the gateway', async () => {
    const res = await POST(
      request({
        kind: 'message',
        name: 'S',
        email: 's@e.co',
        consentTextVersion: 'v1',
        consentChannels: ['carrier_pigeon'],
      }),
      ctx,
    );
    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects an unknown kind without calling the gateway', async () => {
    const res = await POST(request({ kind: 'booking' }), ctx);
    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('passes the upstream status through', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'not_found', message: 'x' } }), { status: 404 }),
    );
    const res = await POST(request({ kind: 'message', name: 'S', email: 's@e.co' }), ctx);
    expect(res.status).toBe(404);
  });

  it('answers 503 when the gateway is unreachable', async () => {
    mockFetch.mockRejectedValue(new Error('down'));
    const res = await POST(request({ kind: 'message', name: 'S', email: 's@e.co' }), ctx);
    expect(res.status).toBe(503);
  });
});
