/** @jest-environment node */
import { GET } from './route';
import { OPENFREEMAP_STYLE_URL } from '@/lib/map-providers';

const original = process.env.MAPTILER_API_KEY;

afterEach(() => {
  if (original === undefined) delete process.env.MAPTILER_API_KEY;
  else process.env.MAPTILER_API_KEY = original;
});

describe('GET /api/map-config', () => {
  it('returns OpenFreeMap when no MapTiler key is set', async () => {
    delete process.env.MAPTILER_API_KEY;

    const body = await (await GET()).json();

    expect(body.provider).toBe('openfreemap');
    expect(body.styleUrl).toBe(OPENFREEMAP_STYLE_URL);
    expect(body.attribution).toContain('OpenFreeMap');
    expect(body.attribution).toContain('OpenMapTiles');
    expect(body.attribution).toContain('OpenStreetMap');
  });

  it('treats an empty key as unset', async () => {
    process.env.MAPTILER_API_KEY = '';

    expect((await (await GET()).json()).provider).toBe('openfreemap');
  });

  it('returns MapTiler raster tiles when the key is set', async () => {
    process.env.MAPTILER_API_KEY = 'test-key';

    const body = await (await GET()).json();

    expect(body.provider).toBe('maptiler');
    expect(body.tileUrl).toContain('api.maptiler.com');
    expect(body.tileUrl).toContain('key=test-key');
    expect(body.attribution).toContain('MapTiler');
  });

  it.each([undefined, 'test-key'])('never points at the OSM tile host (key: %s)', async (key) => {
    if (key === undefined) delete process.env.MAPTILER_API_KEY;
    else process.env.MAPTILER_API_KEY = key;

    expect(JSON.stringify(await (await GET()).json())).not.toContain('tile.openstreetmap.org');
  });
});
