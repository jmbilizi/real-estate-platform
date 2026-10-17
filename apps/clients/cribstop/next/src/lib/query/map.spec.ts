import type { MapBounds } from '@cribstop/property-contracts';
import { getListingCard, getListingsMap } from '@/lib/api/listings';
import { MAP_CARD_STALE_MS, mapCardOptions, viewportPinsOptions } from './map';

jest.mock('@/lib/api/listings', () => ({
  getListingCard: jest.fn(),
  getListingsMap: jest.fn(),
}));

const bounds = (west: number): MapBounds =>
  ({ west, south: 38.9, east: -77.0, north: 39.0 }) as MapBounds;

describe('map query options (#899)', () => {
  it('gives two views under 11 meters apart one key', () => {
    const a = viewportPinsOptions({}, bounds(-77.100001));
    const b = viewportPinsOptions({}, bounds(-77.100004));
    expect(a.queryKey).toEqual(b.queryKey);
    expect(viewportPinsOptions({}, bounds(-77.2)).queryKey).not.toEqual(a.queryKey);
  });

  it('passes the query signal to the viewport request', async () => {
    const signal = new AbortController().signal;
    const options = viewportPinsOptions({}, bounds(-77.1));
    await (options.queryFn as (c: { signal: AbortSignal }) => Promise<unknown>)({ signal });
    expect(getListingsMap).toHaveBeenCalledWith({}, expect.anything(), signal);
  });

  it('keeps a map card as long as the old cache did, and passes the signal', async () => {
    const options = mapCardOptions('abc');
    expect(options.staleTime).toBe(MAP_CARD_STALE_MS);
    const signal = new AbortController().signal;
    await (options.queryFn as (c: { signal: AbortSignal }) => Promise<unknown>)({ signal });
    expect(getListingCard).toHaveBeenCalledWith('abc', signal);
  });
});
