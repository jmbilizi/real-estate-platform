import { searchableSuggestions, searchTargetFor } from './search-place';
import { formatLocationLabel } from './search-utils';
import {
  clearWhereSuggestCache,
  fetchWhereSuggestions,
  SUGGESTIONS_UNAVAILABLE_MESSAGE,
  suggestPrefix,
  toPlaceResult,
} from './where-suggest';

const okBody = (suggestions: unknown[]) =>
  jest.fn(async () => ({ ok: true, json: async () => ({ suggestions }) }) as Response);

beforeEach(() => clearWhereSuggestCache());

describe('source choice', () => {
  it('asks our own suggest endpoint and never Nominatim', async () => {
    const fetcher = okBody([]);
    await fetchWhereSuggestions('Rock', fetcher as unknown as typeof fetch);
    const url = String((fetcher.mock.calls[0] as unknown[])[0]);
    expect(url).toBe('/api/listings/suggest?q=rock');
    expect(url).not.toContain('geocode');
    expect(url).not.toContain('nominatim');
  });

  it('suggests for the place part of "City, ST"', () => {
    expect(suggestPrefix('Rockville, MD')).toBe('rockville');
  });

  it('makes no request under 2 characters', async () => {
    const fetcher = okBody([]);
    const result = await fetchWhereSuggestions('r', fetcher as unknown as typeof fetch);
    expect(result).toEqual({ status: 'ok', suggestions: [] });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('maps every kind to a searchable place', () => {
    const city = toPlaceResult({ kind: 'city', name: 'Rockville', city: 'Rockville', state: 'MD' });
    const zip = toPlaceResult({
      kind: 'zip',
      name: '20850',
      city: 'Rockville',
      state: 'MD',
      zip: '20850',
    });
    const hood = toPlaceResult({
      kind: 'neighborhood',
      name: 'Twinbrook',
      city: 'Rockville',
      state: 'MD',
    });
    expect(searchableSuggestions([city, zip, hood])).toHaveLength(3);
    expect(searchTargetFor('', city)).toEqual({
      kind: 'place',
      place: { kind: 'city', city: 'Rockville', state: 'MD' },
    });
    expect(searchTargetFor('', zip)).toEqual({
      kind: 'place',
      place: { kind: 'zip', zip: '20850', city: 'Rockville', state: 'MD' },
    });
    expect(searchTargetFor('', hood)).toEqual({
      kind: 'place',
      place: { kind: 'neighborhood', name: 'Twinbrook', city: 'Rockville', state: 'MD' },
    });
    expect(formatLocationLabel(city)).toBe('Rockville, MD');
    expect(formatLocationLabel(hood)).toBe('Twinbrook, Rockville, MD');
    expect(formatLocationLabel(zip)).toBe('Rockville, MD 20850');
  });
});

describe('cache', () => {
  it('serves a repeated prefix without a second request', async () => {
    const fetcher = okBody([{ kind: 'city', name: 'Rockville', city: 'Rockville', state: 'MD' }]);
    await fetchWhereSuggestions('rock', fetcher as unknown as typeof fetch);
    const again = await fetchWhereSuggestions('ROCK', fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(again.status === 'ok' && again.suggestions).toHaveLength(1);
  });

  it('does not cache an empty answer', async () => {
    const fetcher = okBody([]);
    await fetchWhereSuggestions('zzzz', fetcher as unknown as typeof fetch);
    await fetchWhereSuggestions('zzzz', fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('cuts the prefix to the API limit', () => {
    expect(suggestPrefix('a'.repeat(60))).toHaveLength(40);
  });

  it('does not cache a failure', async () => {
    const failing = jest.fn(async () => ({ ok: false, json: async () => ({}) }) as Response);
    await fetchWhereSuggestions('rock', failing as unknown as typeof fetch);
    await fetchWhereSuggestions('rock', failing as unknown as typeof fetch);
    expect(failing).toHaveBeenCalledTimes(2);
  });
});

describe('failure', () => {
  it('reports unavailable for a non-OK response, not an empty list', async () => {
    const failing = jest.fn(async () => ({ ok: false, json: async () => [] }) as Response);
    expect(await fetchWhereSuggestions('rock', failing as unknown as typeof fetch)).toEqual({
      status: 'unavailable',
    });
  });

  it('reports unavailable when the request throws', async () => {
    const throwing = jest.fn(async () => {
      throw new Error('network');
    });
    expect(await fetchWhereSuggestions('rock', throwing as unknown as typeof fetch)).toEqual({
      status: 'unavailable',
    });
  });

  it('uses the ticket wording', () => {
    expect(SUGGESTIONS_UNAVAILABLE_MESSAGE).toBe('Suggestions unavailable, press Enter to search');
  });
});
