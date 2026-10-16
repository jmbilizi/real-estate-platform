/** @jest-environment node */
import { NextRequest } from 'next/server';
import { fetchGatewayAsUser } from '@/app/api/_lib/authed-gateway';
import { GET, PUT } from './route';

jest.mock('@/app/api/_lib/authed-gateway');
const mockedFetch = fetchGatewayAsUser as jest.Mock;

const req = (body?: unknown) =>
  new NextRequest('http://localhost/api/account/notification-preferences', {
    method: body === undefined ? 'GET' : 'PUT',
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe('notification-preferences route', () => {
  afterEach(() => jest.resetAllMocks());

  it('GET passes the wording through', async () => {
    mockedFetch.mockResolvedValue(Response.json({ consentWording: { id: 'x' } }));
    expect((await (await GET(req())).json()).consentWording.id).toBe('x');
  });

  it('GET passes the upstream status through on failure', async () => {
    mockedFetch.mockResolvedValue(new Response(null, { status: 401 }));
    expect((await GET(req())).status).toBe(401);
  });

  it('PUT forwards only the known item fields', async () => {
    mockedFetch.mockResolvedValue(Response.json({}, { status: 200 }));
    const res = await PUT(
      req({
        items: [
          {
            channel: 'email',
            category: 'non_transactional',
            enabled: true,
            consentWordingId: 'email_non_transactional',
            consentText: 'free text',
          },
        ],
      }),
    );
    expect(res.status).toBe(200);
    expect(mockedFetch).toHaveBeenCalledWith(
      expect.anything(),
      '/account/notification-preferences',
      {
        method: 'PUT',
        body: {
          items: [
            {
              channel: 'email',
              category: 'non_transactional',
              enabled: true,
              consentWordingId: 'email_non_transactional',
            },
          ],
        },
      },
    );
  });

  it('PUT passes a service error through', async () => {
    mockedFetch.mockResolvedValue(
      Response.json({ error: 'unknown_consent_wording' }, { status: 400 }),
    );
    const res = await PUT(req({ items: [{ channel: 'email' }] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('unknown_consent_wording');
  });

  it('PUT rejects a body with no items', async () => {
    expect((await PUT(req({}))).status).toBe(400);
  });
});
