import { enrichNearbyLocal } from './nearby-enrich';
import { clearWhereSuggestCache } from './where-suggest';
import { formatLocationLabel } from './search-utils';

function jsonFetch(body: unknown) {
  return jest.fn(async () => ({ ok: true, status: 200, json: async () => body }));
}

describe('enrichNearbyLocal', () => {
  beforeEach(() => clearWhereSuggestCache());

  it('never calls Nominatim and labels from local listing data', async () => {
    const fetcher = jsonFetch({
      suggestions: [{ kind: 'city', name: 'Rockville', city: 'Rockville', state: 'MD' }],
    });
    const out = await enrichNearbyLocal(
      [{ display_name: 'Rockville', lat: 1, lon: 2, type: 'city' }],
      'DC',
      fetcher as unknown as typeof fetch,
    );
    expect(formatLocationLabel(out[0])).toBe('Rockville, MD');
    for (const call of fetcher.mock.calls as unknown as string[][]) {
      expect(call[0]).not.toContain('geocode');
    }
  });

  it('uses the OSM state tag with no request', async () => {
    const fetcher = jsonFetch({ suggestions: [] });
    const out = await enrichNearbyLocal(
      [{ display_name: 'Bethesda', 'addr:state': 'md' }],
      'DC',
      fetcher as unknown as typeof fetch,
    );
    expect(formatLocationLabel(out[0])).toBe('Bethesda, MD');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('falls back to the center state when no local match exists', async () => {
    const fetcher = jsonFetch({ suggestions: [] });
    const out = await enrichNearbyLocal(
      [{ display_name: 'Smalltown' }],
      'VA',
      fetcher as unknown as typeof fetch,
    );
    expect(formatLocationLabel(out[0])).toBe('Smalltown, VA');
  });
});
