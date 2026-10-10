/**
 * @jest-environment node
 *
 * The default jsdom environment has no Web `Response`.
 */
import { createNominatimGate } from './nominatim-gate';
import { clearNominatimCache, proxyNominatim } from './nominatim-fetch';

const built = { ok: true as const, url: 'https://nominatim.openstreetmap.org/search?q=rockville' };
const open = { acquire: async () => true };

describe('nominatim gate', () => {
  it('spaces upstream calls by the minimum interval', async () => {
    let clock = 0;
    const slept: number[] = [];
    const gate = createNominatimGate({
      minIntervalMs: 1000,
      now: () => clock,
      sleep: async (ms) => {
        slept.push(ms);
        clock += ms;
      },
    });
    await gate.acquire();
    await gate.acquire();
    await gate.acquire();
    expect(slept).toEqual([1000, 1000]);
  });

  it('shares the 1 req/s budget across replicas', async () => {
    process.env.NOMINATIM_REPLICAS = '3';
    try {
      let clock = 0;
      const slept: number[] = [];
      const gate = createNominatimGate({
        now: () => clock,
        sleep: async (ms) => {
          slept.push(ms);
          clock += ms;
        },
      });
      await gate.acquire();
      await gate.acquire();
      expect(slept).toEqual([3300]);
    } finally {
      delete process.env.NOMINATIM_REPLICAS;
    }
  });

  it('refuses a call when the wait is over the limit', async () => {
    const gate = createNominatimGate({
      minIntervalMs: 1000,
      maxWaitMs: 1500,
      now: () => 0,
      sleep: async () => undefined,
    });
    expect(await gate.acquire()).toBe(true);
    expect(await gate.acquire()).toBe(true);
    expect(await gate.acquire()).toBe(false);
  });
});

describe('proxyNominatim', () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    clearNominatimCache();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('sends an identifying User-Agent and caches a good answer', async () => {
    const fetchMock = jest.fn(async () => Response.json([{ place_id: 1 }]));
    global.fetch = fetchMock as unknown as typeof fetch;

    const first = await proxyNominatim(built, 'test', open);
    const second = await proxyNominatim(built, 'test', open);

    expect(await first.json()).toEqual([{ place_id: 1 }]);
    expect(await second.json()).toEqual([{ place_id: 1 }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)['User-Agent']).toMatch(/^real-estate-platform/);
  });

  it('shares one upstream call between concurrent requests for one URL', async () => {
    const fetchMock = jest.fn(async () => Response.json([{ place_id: 1 }]));
    global.fetch = fetchMock as unknown as typeof fetch;
    const acquire = jest.fn(async () => true);

    const [a, b] = await Promise.all([
      proxyNominatim(built, 'test', { acquire }),
      proxyNominatim(built, 'test', { acquire }),
    ]);

    expect(await a.json()).toEqual(await b.json());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(acquire).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failure', async () => {
    const fetchMock = jest.fn(async () => new Response('{}', { status: 429 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    expect((await proxyNominatim(built, 'test', open)).status).toBe(502);
    await proxyNominatim(built, 'test', open);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('answers 429 without calling upstream when the gate refuses', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const response = await proxyNominatim(built, 'test', { acquire: async () => false });

    expect(response.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
