/** @jest-environment node */
/** #954: readiness proves the server reaches the gateway. */
import { GET } from './route';

const ORIGINAL_FETCH = global.fetch;

describe('GET /api/health/ready', () => {
  beforeEach(() => {
    process.env.API_GATEWAY_URL = 'http://gateway.test:8080';
  });
  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
  });

  it('returns 200 when the gateway is ready', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock as unknown as typeof fetch;
    const res = await GET();
    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toBe('http://gateway.test:8080/health/ready');
  });

  it('returns 503 when the gateway is not ready', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch;
    expect((await GET()).status).toBe(503);
  });

  it('returns 503 when the gateway is unreachable', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('down')) as unknown as typeof fetch;
    expect((await GET()).status).toBe(503);
  });
});
