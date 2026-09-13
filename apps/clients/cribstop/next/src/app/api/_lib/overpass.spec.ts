import {
  buildNearbyPlacesQuery,
  COORD_PRECISION,
  DEFAULT_RADIUS_METERS,
  MAX_RADIUS_METERS,
  MIN_RADIUS_METERS,
} from './overpass';

const build = (qs: string) => buildNearbyPlacesQuery(new URLSearchParams(qs));

/** The query text a successful build produced, for asserting on what we send upstream. */
const queryOf = (r: ReturnType<typeof buildNearbyPlacesQuery>) => (r.ok ? r.query : '');

/** The coordinates from a real request, at the full float precision the map centre arrives with. */
const VALID = 'lat=38.89553417351007&lon=-77.07075970701736&placeType=city';

/**
 * The Overpass proxy's query construction.
 *
 * Everything here decides what a free, shared, heavily loaded public endpoint is asked for under
 * our identity and our rate limit, so it is tested directly rather than through the route handler.
 */
describe('buildNearbyPlacesQuery', () => {
  it('builds a radius lookup for the requested place type', () => {
    const query = queryOf(build(VALID));

    expect(query).toContain('[out:json]');
    expect(query).toContain('node[place=city]');
    expect(query).toContain(`around:${DEFAULT_RADIUS_METERS},38.896,-77.071`);
  });

  it.each(['city', 'town', 'village'])('accepts the %s place type', (placeType) => {
    expect(build(`lat=38.8955&lon=-77.0707&placeType=${placeType}`).ok).toBe(true);
  });

  it.each(['', 'placeType=', 'placeType=county', 'placeType=node];out;//'])(
    'rejects a place type outside the allowlist (%s)',
    (placeTypeQs) => {
      expect(build(`lat=38.8955&lon=-77.0707&${placeTypeQs}`).ok).toBe(false);
    },
  );

  /**
   * `Number(params.get(name))` reads a missing parameter back as `0`, not `NaN`, so this used to
   * validate as the real point (0, 0) and get forwarded upstream.
   */
  it.each(['lon=-77.0707&placeType=city', 'lat=38.8955&placeType=city', 'placeType=city'])(
    'rejects a request with a coordinate missing (%s)',
    (qs) => {
      expect(build(qs).ok).toBe(false);
    },
  );

  it.each(['lat=&lon=&placeType=city', 'lat=%20&lon=%20&placeType=city'])(
    'rejects a blank coordinate rather than reading it as zero (%s)',
    (qs) => {
      expect(build(qs).ok).toBe(false);
    },
  );

  /** Zero is a real coordinate when it is actually asked for — only *absence* is rejected. */
  it('accepts an explicit zero coordinate', () => {
    expect(build('lat=0&lon=0&placeType=city').ok).toBe(true);
  });

  /*
   * Range, not just finiteness. A latitude of 500 is a perfectly finite number and an impossible
   * place — forwarding it spends an upstream request to be told so.
   */
  it.each([
    ['non-numeric latitude', 'lat=abc&lon=-77.0707&placeType=city'],
    ['latitude past the pole', 'lat=91&lon=-77.0707&placeType=city'],
    ['longitude past the meridian', 'lat=38.8955&lon=181&placeType=city'],
  ])('rejects %s', (_label, qs) => {
    expect(build(qs).ok).toBe(false);
  });

  it.each([-90, 90, 0])('accepts the boundary latitude %s', (lat) => {
    expect(build(`lat=${lat}&lon=0&placeType=city`).ok).toBe(true);
  });

  /**
   * Rounding is what makes the proxy's `Cache-Control` worth anything: the map centre arrives at
   * full float precision, so without this every pixel of pan is a cache key never seen before.
   */
  describe('coordinate rounding', () => {
    it('rounds the centre onto the shared grid', () => {
      const query = queryOf(build('lat=38.89553417351007&lon=-77.07075970701736&placeType=city'));

      expect(query).toContain('38.896,-77.071');
      expect(query).not.toContain('38.89553417351007');
    });

    it('collapses two nearby centres onto the same query', () => {
      const a = queryOf(build('lat=38.895534&lon=-77.070759&placeType=city'));
      const b = queryOf(build('lat=38.895601&lon=-77.070812&placeType=city'));

      expect(a).toBe(b);
    });

    it('keeps enough precision to distinguish genuinely different places', () => {
      const dc = queryOf(build('lat=38.8955&lon=-77.0707&placeType=city'));
      const baltimore = queryOf(build('lat=39.2904&lon=-76.6122&placeType=city'));

      expect(dc).not.toBe(baltimore);
    });

    it('rounds to the precision the client is also using', () => {
      // Guards the constant itself: `lib/search-utils.tsx` rounds to this same grid before building
      // the URL, and a drift between the two costs cache hits.
      expect(COORD_PRECISION).toBe(3);
    });
  });

  /**
   * The radius was forwarded unvalidated, so a caller could ask for a continent-sized query in our
   * name, and a non-numeric value reached the query as `around:NaN` and came back a 502.
   */
  describe('radius bounds', () => {
    it('passes an in-range radius through unchanged', () => {
      expect(queryOf(build(`${VALID}&radiusMeters=15000`))).toContain('around:15000,');
    });

    it('clamps a radius past the ceiling', () => {
      expect(queryOf(build(`${VALID}&radiusMeters=99999999`))).toContain(
        `around:${MAX_RADIUS_METERS},`,
      );
    });

    it('clamps a radius below the floor', () => {
      expect(queryOf(build(`${VALID}&radiusMeters=1`))).toContain(`around:${MIN_RADIUS_METERS},`);
    });

    it.each(['radiusMeters=abc', 'radiusMeters='])(
      'falls back to the default for a non-numeric radius (%s)',
      (radiusQs) => {
        expect(queryOf(build(`${VALID}&${radiusQs}`))).toContain(
          `around:${DEFAULT_RADIUS_METERS},`,
        );
      },
    );

    it('defaults the radius when none is given', () => {
      expect(queryOf(build(VALID))).toContain(`around:${DEFAULT_RADIUS_METERS},`);
    });

    it('never emits a NaN radius', () => {
      for (const qs of ['radiusMeters=abc', 'radiusMeters=', 'radiusMeters=Infinity']) {
        expect(queryOf(build(`${VALID}&${qs}`))).not.toContain('NaN');
      }
    });
  });
});
