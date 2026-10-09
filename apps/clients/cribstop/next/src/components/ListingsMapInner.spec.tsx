/**
 * Leaflet does not run under jsdom, and `react-leaflet` ships ESM that this workspace's
 * `ts-jest` transform (no Babel, so no `babel-plugin-jest-hoist`) cannot parse — importing
 * `ListingsMapInner` unmocked fails at `require('react-leaflet')` before any test runs, even
 * though nothing here renders the map. These are lightweight stand-ins so importing the module
 * to reach its one pure export (`selectMappableListings`) doesn't drag that dependency chain in.
 * They must be registered *before* `./ListingsMapInner` is imported below — with no Babel hoist,
 * ts-jest preserves source order, so `jest.mock` has to appear first textually.
 */
const mockMap: { current: unknown } = { current: null };
jest.mock('react-leaflet', () => ({
  MapContainer: () => null,
  TileLayer: () => null,
  useMap: () => mockMap.current ?? { getContainer: () => document.createElement('div') },
}));
// maplibre-gl ships ESM and needs WebGL, so jsdom cannot load it.
jest.mock('@/components/BasemapLayer', () => ({ __esModule: true, default: () => null }));
jest.mock('leaflet', () => ({ __esModule: true, default: { CircleMarker: class {} } }));

import {
  getSampleBannerCopy,
  sampleBannerCopyFor,
  selectMappableListings,
  UserMoveReporter,
} from './ListingsMapInner';
import { act, render } from '@testing-library/react';
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

describe('getSampleBannerCopy', () => {
  it('returns null when no pin is a sample', () => {
    const real = aListingCardRow({ isSample: false });

    expect(getSampleBannerCopy([real])).toBeNull();
  });

  it('claims the whole map is illustrative when every pin is a sample', () => {
    const sample = aListingCardRow({ isSample: true });

    expect(getSampleBannerCopy([sample])).toBe(
      'Sample data — prices shown on this map are illustrative.',
    );
  });

  it('scopes the claim to the sample subset in a mixed pin set (#120)', () => {
    const sample = aListingCardRow({ id: 'a', isSample: true });
    const real = aListingCardRow({ id: 'b', isSample: false });

    const copy = getSampleBannerCopy([sample, real]);

    expect(copy).not.toContain('this map are illustrative');
    expect(copy).toBe('Some listings on this map are sample data — their prices are illustrative.');
  });
});

describe('sampleBannerCopyFor (#377 viewport counts)', () => {
  it('scopes the claim to the sample share of the viewport', () => {
    expect(sampleBannerCopyFor(0, 40)).toBeNull();
    expect(sampleBannerCopyFor(40, 40)).toBe(
      getSampleBannerCopy([aListingCardRow({ isSample: true })]),
    );
    expect(sampleBannerCopyFor(3, 40)).toContain('Some listings');
  });
});

/** The map reports a move only when the view really changed (#746). */
describe('UserMoveReporter', () => {
  type Handler = () => void;
  const PINS: [number, number][] = [
    [38.85, -77.05],
    [38.86, -77.04],
  ];
  const wide = { west: -77.1, south: 38.8, east: -77.0, north: 38.9 };
  // A pan east that moves the first pin out of view.
  const panned = { west: -77.045, south: 38.8, east: -76.945, north: 38.9 };

  const setup = () => {
    const handlers = new Map<string, Handler[]>();
    const state = { bounds: wide, zoom: 12 };
    const container = document.createElement('div');
    mockMap.current = {
      getContainer: () => container,
      getZoom: () => state.zoom,
      getBounds: () => ({
        getWest: () => state.bounds.west,
        getSouth: () => state.bounds.south,
        getEast: () => state.bounds.east,
        getNorth: () => state.bounds.north,
      }),
      scrollWheelZoom: { enabled: () => true },
      on: (name: string, fn: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), fn]),
      off: jest.fn(),
    };
    const fire = (name: string) => handlers.get(name)?.forEach((fn) => fn());
    const onUserMove = jest.fn();
    render(<UserMoveReporter onUserMove={onUserMove} emitted={{ current: '' }} points={PINS} />);
    const settle = () => act(() => void jest.advanceTimersByTime(500));
    return { state, fire, container, onUserMove, settle };
  };

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    mockMap.current = null;
  });

  it('ignores a tap and a pin click, which move no map', () => {
    const { container, onUserMove, settle } = setup();

    container.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    settle();

    expect(onUserMove).not.toHaveBeenCalled();
  });

  it('ignores a popup open, even right after a drag', () => {
    const { state, fire, onUserMove, settle } = setup();

    fire('dragstart');
    state.bounds = panned;
    fire('moveend');
    fire('popupopen');
    settle();

    expect(onUserMove).not.toHaveBeenCalled();
  });

  it('ignores a 5 px drag that keeps every result in view', () => {
    const { state, fire, onUserMove, settle } = setup();

    fire('dragstart');
    state.bounds = { ...wide, west: wide.west + 0.0001, east: wide.east + 0.0001 };
    fire('dragend');
    fire('moveend');
    settle();

    expect(onUserMove).not.toHaveBeenCalled();
  });

  it('reports a pan that moves a result out of view', () => {
    const { state, fire, onUserMove, settle } = setup();

    fire('dragstart');
    state.bounds = panned;
    fire('dragend');
    fire('moveend');
    settle();

    expect(onUserMove).toHaveBeenCalledWith(expect.objectContaining({ west: panned.west }));
  });

  it('reports a zoom change of 0.5 or more and ignores a smaller one', () => {
    const { state, fire, container, onUserMove, settle } = setup();

    container.dispatchEvent(new WheelEvent('wheel'));
    state.zoom = 12.4;
    fire('moveend');
    settle();
    expect(onUserMove).not.toHaveBeenCalled();

    container.dispatchEvent(new WheelEvent('wheel'));
    state.zoom = 13;
    fire('moveend');
    settle();
    expect(onUserMove).toHaveBeenCalledTimes(1);
  });

  it('judges a zoom against the last committed view, so an app fit resets it', () => {
    const { state, fire, container, onUserMove, settle } = setup();

    state.zoom = 14; // the app fits the place
    fire('moveend');
    container.dispatchEvent(new WheelEvent('wheel'));
    state.zoom = 14.3;
    fire('moveend');
    settle();

    expect(onUserMove).not.toHaveBeenCalled();
  });
});
