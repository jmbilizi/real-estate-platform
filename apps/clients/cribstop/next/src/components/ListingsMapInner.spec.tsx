/**
 * Leaflet does not run under jsdom, and `react-leaflet` ships ESM that this workspace's
 * `ts-jest` transform (no Babel, so no `babel-plugin-jest-hoist`) cannot parse — importing
 * `ListingsMapInner` unmocked fails at `require('react-leaflet')` before any test runs, even
 * though nothing here renders the map. These are lightweight stand-ins so importing the module
 * to reach its one pure export (`selectMappableListings`) doesn't drag that dependency chain in.
 * They must be registered *before* `./ListingsMapInner` is imported below — with no Babel hoist,
 * ts-jest preserves source order, so `jest.mock` has to appear first textually.
 */
jest.mock('react-leaflet', () => ({
  MapContainer: () => null,
  TileLayer: () => null,
  useMap: () => ({ getContainer: () => document.createElement('div') }),
}));
jest.mock('leaflet', () => ({ __esModule: true, default: {} }));
jest.mock('leaflet.markercluster', () => ({}));

import { selectMappableListings } from './ListingsMapInner';
import { aListingCardRow, aSuppressedAddressRow } from '@/test/fixtures';

describe('selectMappableListings', () => {
  it('excludes a suppressed-address row (address, latitude and longitude null together)', () => {
    const suppressed = aSuppressedAddressRow();

    expect(selectMappableListings([suppressed])).toEqual([]);
  });

  it('includes a normal row that has coordinates', () => {
    const row = aListingCardRow();

    expect(selectMappableListings([row])).toEqual([row]);
  });

  it('includes a row at 0,0 — a zero coordinate is a real value, not a missing one', () => {
    const row = aListingCardRow({ latitude: 0, longitude: 0 });

    expect(selectMappableListings([row])).toEqual([row]);
  });

  it('can return fewer pins than the input has rows', () => {
    const visible = aListingCardRow();
    const suppressed = aSuppressedAddressRow();

    const pins = selectMappableListings([visible, suppressed]);

    expect(pins).toHaveLength(1);
    expect(pins).toEqual([visible]);
  });

  it('never mutates or reorders the input', () => {
    const visible = aListingCardRow({ id: 'a' });
    const suppressed = aSuppressedAddressRow({ id: 'b' });
    const other = aListingCardRow({ id: 'c' });
    const input = [suppressed, other, visible];
    const inputCopy = [...input];

    const pins = selectMappableListings(input);

    // Input array is untouched: same length, same elements, same order.
    expect(input).toEqual(inputCopy);
    expect(input).toHaveLength(3);
    // Relative order of the survivors is preserved from the input.
    expect(pins.map((l) => l.id)).toEqual(['c', 'a']);
  });
});
