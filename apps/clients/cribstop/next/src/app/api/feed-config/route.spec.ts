/** @jest-environment node */
import { GET } from './route';

afterEach(() => {
  delete process.env.HOME_FEED_ENABLED;
  delete process.env.HOME_FEED_ROLLOUT_PCT;
});

describe('GET /api/feed-config', () => {
  it('is off by default', async () => {
    const res = GET();
    expect(await res.json()).toEqual({ enabled: false, rolloutPct: 0 });
  });

  it('reads the runtime env and clamps the percent', async () => {
    process.env.HOME_FEED_ENABLED = 'true';
    process.env.HOME_FEED_ROLLOUT_PCT = '250';
    expect(await GET().json()).toEqual({ enabled: true, rolloutPct: 100 });
  });

  it('is cacheable by a shared cache for 60 seconds', () => {
    expect(GET().headers.get('cache-control')).toContain('s-maxage=60');
    expect(GET().headers.get('cache-control')).toContain('public');
  });
});
