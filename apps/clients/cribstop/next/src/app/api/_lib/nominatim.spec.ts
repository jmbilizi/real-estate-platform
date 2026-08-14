import { buildForwardUrl, buildReverseUrl } from './nominatim';

const forward = (qs: string) => buildForwardUrl(new URLSearchParams(qs));
const reverse = (qs: string) => buildReverseUrl(new URLSearchParams(qs));

/** The upstream URL a successful build produced, for asserting on its query string. */
const urlOf = (r: ReturnType<typeof buildForwardUrl>) => (r.ok ? r.url : '');

/**
 * The geocode proxy's query handling.
 *
 * The allowlist is the security-relevant half of this proxy, so it is tested here directly rather
 * than through a route handler. A pass-through would make us an open relay to a third party under
 * our identity and our rate limit; the parameter set a geocoder needs is small and closed, so
 * enumerating it costs nothing.
 */
describe('buildForwardUrl', () => {
  it('builds a place lookup with the fixed parameters this app always wants', () => {
    const url = urlOf(forward('q=Alexandria, VA'));

    expect(url).toContain('https://nominatim.openstreetmap.org/search?');
    expect(url).toContain('format=json');
    expect(url).toContain('countrycodes=us');
    expect(url).toContain('q=Alexandria%2C%20VA');
  });

  /** A ZIP goes through `postalcode` so the boundary is the ZIP's, not its containing city's. */
  it('looks a ZIP up as a postal code', () => {
    expect(urlOf(forward('postalcode=22314'))).toContain('postalcode=22314');
  });

  it.each(['postalcode=2231', 'postalcode=223145', 'postalcode=abcde'])(
    'rejects a malformed postcode (%s)',
    (qs) => {
      expect(forward(qs).ok).toBe(false);
    },
  );

  it('rejects a request that supplies both a query and a postcode', () => {
    expect(forward('q=Alexandria&postalcode=22314').ok).toBe(false);
  });

  it.each(['', 'q=', 'q=%20%20'])('rejects an empty query (%s)', (qs) => {
    expect(forward(qs).ok).toBe(false);
  });

  it('rejects an over-long query rather than relaying it upstream', () => {
    expect(forward(`q=${'a'.repeat(201)}`).ok).toBe(false);
  });

  /**
   * `polygon=1` is our flag, not Nominatim's: it selects the boundary *and* the vertex
   * simplification, so no caller can request the unsimplified geometry — which is hundreds of KB.
   */
  it('turns polygon=1 into the boundary request with simplification attached', () => {
    const url = urlOf(forward('q=Alexandria&polygon=1'));

    expect(url).toContain('polygon_geojson=1');
    expect(url).toContain('polygon_threshold=0.005');
  });

  it('omits the polygon entirely when it is not asked for', () => {
    expect(urlOf(forward('q=Alexandria'))).not.toContain('polygon');
  });

  it.each(['q=Alexandria&polygon=0', 'q=Alexandria&polygon=yes'])(
    'rejects a polygon value it does not define (%s)',
    (qs) => {
      expect(forward(qs).ok).toBe(false);
    },
  );

  it.each(['limit=0', 'limit=11', 'limit=abc'])('rejects an out-of-range limit (%s)', (limit) => {
    expect(forward(`q=Alexandria&${limit}`).ok).toBe(false);
  });

  /**
   * The point of the allowlist: an unknown parameter is dropped, not relayed. Without this the
   * proxy would forward whatever a caller appended — `email`, `dedupe`, another `countrycodes` —
   * under our User-Agent.
   */
  it.each([
    ['email=someone@example.com', 'email'],
    ['countrycodes=fr', 'fr'],
    ['viewbox=1,2,3,4', 'viewbox'],
    ['dedupe=0', 'dedupe'],
  ])('drops the unexpected parameter %s', (extra, needle) => {
    const url = urlOf(forward(`q=Alexandria&${extra}`));

    expect(url).not.toContain(needle);
  });

  it('never lets an extra countrycodes override the US restriction', () => {
    const url = urlOf(forward('q=Alexandria&countrycodes=fr'));

    expect(url).toContain('countrycodes=us');
    expect(url).not.toContain('countrycodes=fr');
  });
});

describe('buildReverseUrl', () => {
  it('builds a reverse lookup from a coordinate', () => {
    const url = urlOf(reverse('lat=38.8&lon=-77.04'));

    expect(url).toContain('https://nominatim.openstreetmap.org/reverse?');
    expect(url).toContain('lat=38.8');
    expect(url).toContain('lon=-77.04');
    expect(url).toContain('zoom=10');
  });

  it.each([
    ['lat=91&lon=0', 'latitude above range'],
    ['lat=-91&lon=0', 'latitude below range'],
    ['lat=0&lon=181', 'longitude above range'],
    ['lat=0&lon=-181', 'longitude below range'],
    ['lat=abc&lon=0', 'non-numeric latitude'],
    ['lon=0', 'missing latitude'],
    ['lat=0', 'missing longitude'],
  ])('rejects %s (%s)', (qs) => {
    expect(reverse(qs).ok).toBe(false);
  });

  it.each(['zoom=19', 'zoom=-1', 'zoom=ten'])('rejects an out-of-range zoom (%s)', (zoom) => {
    expect(reverse(`lat=38.8&lon=-77.04&${zoom}`).ok).toBe(false);
  });

  it('drops an unexpected parameter here too', () => {
    expect(urlOf(reverse('lat=38.8&lon=-77.04&email=someone@example.com'))).not.toContain('email');
  });
});
