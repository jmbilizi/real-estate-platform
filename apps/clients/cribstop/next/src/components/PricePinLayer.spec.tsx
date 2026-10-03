/**
 * Real Leaflet on jsdom, with `useMap` returning a real map. Canvas has no jsdom backend, so
 * `getContext` is a no-op stub. The tests count what is on the map, not what it paints.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { act, render } from '@testing-library/react';
import L from 'leaflet';
import type { MapPin } from '@cribstop/property-contracts';

let mockMap: L.Map;
jest.mock('react-leaflet', () => ({ useMap: () => mockMap }));
jest.mock('@/components/ListingCard', () => ({ __esModule: true, default: () => null }));

import PricePinLayer from './PricePinLayer';
import { formatListingPriceShort } from '@/lib/listing-format';

const CENTER: [number, number] = [38.9, -77.03];

function pin(id: string, dLat: number, dLng: number, extra: Partial<MapPin> = {}): MapPin {
  return {
    id,
    latitude: CENTER[0] + dLat,
    longitude: CENTER[1] + dLng,
    price: 585_000,
    status: 'Active',
    listingType: 'sale',
    ...extra,
  };
}

const noop = () => undefined;
const stubContext = new Proxy({}, { get: () => () => undefined, set: () => true });

let host: HTMLDivElement;

beforeEach(() => {
  jest
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockImplementation(() => stubContext as unknown as CanvasRenderingContext2D);
  host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: 800 });
  Object.defineProperty(host, 'clientHeight', { value: 600 });
  document.body.appendChild(host);
  mockMap = L.map(host, { center: CENTER, zoom: 15 });
});

afterEach(() => {
  mockMap.remove();
  host.remove();
  jest.restoreAllMocks();
});

const pills = () => [...host.querySelectorAll<HTMLElement>('.cribstop-price-pin')];
const dots = () => {
  const found: L.CircleMarker[] = [];
  mockMap.eachLayer((layer) => {
    if (layer instanceof L.CircleMarker) found.push(layer);
  });
  return found;
};

function layer(pins: MapPin[], over: Partial<Parameters<typeof PricePinLayer>[0]> = {}) {
  return (
    <PricePinLayer
      pins={pins}
      rowsById={new Map()}
      activeId={null}
      onOpenListing={noop}
      {...over}
    />
  );
}

describe('PricePinLayer (#546)', () => {
  it('draws one marker per point: a pill each when the pills are clear of each other', () => {
    render(layer([pin('a', 0, -0.004), pin('b', 0, 0), pin('c', 0, 0.004)]));

    expect(pills()).toHaveLength(3);
    expect(dots()).toHaveLength(0);
  });

  it('writes the price from the card formatter family, never a different figure', () => {
    const pins = [
      pin('sale', 0, -0.006, { price: 585_000 }),
      pin('rent', 0, 0, { price: 2100, listingType: 'rent' }),
      pin('none', 0, 0.006, { price: null }),
    ];
    render(layer(pins));

    const labels = pills().map((el) => el.firstElementChild?.getAttribute('data-pin-label'));
    expect(labels).toEqual(pins.map((p) => formatListingPriceShort(p.price, p.listingType).text));
    expect(labels).toEqual(['$585K', '$2.1K/mo', 'Withheld']);
  });

  it('puts the pointer tail tip on the exact coordinate', () => {
    const p = pin('a', 0, 0);
    render(layer([p]));

    const markers: L.Marker[] = [];
    mockMap.eachLayer((l) => {
      if (l instanceof L.Marker) markers.push(l);
    });
    expect(markers).toHaveLength(1);
    expect(markers[0].getLatLng().lat).toBe(p.latitude);
    expect(markers[0].getLatLng().lng).toBe(p.longitude);
    // The anchor is the bottom centre of the 44px icon box, where the tail tip is.
    const { iconSize, iconAnchor } = markers[0].options.icon?.options ?? {};
    const [w, h] = iconSize as [number, number];
    expect(h).toBe(44);
    expect(w).toBeGreaterThanOrEqual(44);
    expect(iconAnchor).toEqual([w / 2, 44]);
  });

  it('turns an overlapping pin into a dot at its own spot, and keeps the first pill whole', () => {
    const first = pin('first', 0, 0);
    const second = pin('second', 0.00001, 0.00001);
    render(layer([first, second]));

    expect(pills()).toHaveLength(1);
    expect(dots()).toHaveLength(1);
    const dot = dots()[0];
    expect(dot.getLatLng().lat).toBeCloseTo(second.latitude, 8);
    expect(dot.getLatLng().lng).toBeCloseTo(second.longitude, 8);
  });

  it('gives a dot a hit area of at least 44px', () => {
    render(layer([pin('first', 0, 0), pin('second', 0.00001, 0.00001)]));

    const dot = dots()[0];
    const tolerance = (dot.options.renderer as L.Canvas).options.tolerance ?? 0;
    expect(2 * (dot.getRadius() + tolerance)).toBeGreaterThanOrEqual(44);
  });

  it('shows the pill while a dot is hovered, and syncs the card highlight', () => {
    const onMarkerHover = jest.fn();
    render(layer([pin('first', 0, 0), pin('second', 0.00001, 0.00001)], { onMarkerHover }));

    const dot = dots()[0];
    act(() => {
      dot.fire('mouseover');
    });
    expect(pills()).toHaveLength(2);
    expect(onMarkerHover).toHaveBeenLastCalledWith('second');

    act(() => {
      dot.fire('mouseout');
    });
    expect(pills()).toHaveLength(1);
    expect(onMarkerHover).toHaveBeenLastCalledWith(null);
  });

  it('opens the listing panel for a pin that is not on the current page', () => {
    const onOpenListing = jest.fn();
    render(layer([pin('first', 0, 0), pin('second', 0.00001, 0.00001)], { onOpenListing }));

    act(() => {
      dots()[0].fire('click');
    });
    expect(onOpenListing).toHaveBeenCalledWith('second');
  });

  it('ends the hover when a dot is tapped, because a touch tap sends no mouseout', () => {
    const onMarkerHover = jest.fn();
    render(layer([pin('first', 0, 0), pin('second', 0.00001, 0.00001)], { onMarkerHover }));

    act(() => {
      dots()[0].fire('mouseover');
      dots()[0].fire('click');
    });

    expect(pills()).toHaveLength(1);
    expect(onMarkerHover).toHaveBeenLastCalledWith(null);
  });

  it('gives the highlighted card its pill and demotes the pin it overlaps', () => {
    const pins = [pin('first', 0, 0), pin('second', 0.00001, 0.00001)];
    const { rerender } = render(layer(pins));
    expect(dots()[0].getLatLng().lat).toBeCloseTo(pins[1].latitude, 8);

    rerender(layer(pins, { activeId: 'second' }));

    expect(pills()).toHaveLength(1);
    expect(dots()[0].getLatLng().lat).toBeCloseTo(pins[0].latitude, 8);
  });

  it('removes every marker on unmount', () => {
    const { unmount } = render(layer([pin('a', 0, -0.004), pin('b', 0, 0.004)]));
    unmount();

    expect(pills()).toHaveLength(0);
    expect(dots()).toHaveLength(0);
  });

  it('draws 2,000 points as markers with a bounded number of pills', () => {
    const many = Array.from({ length: 2000 }, (_, i) =>
      pin(`p${i}`, ((i * 7919) % 1000) / 100_000, ((i * 104_729) % 1000) / 100_000),
    );
    render(layer(many));

    expect(pills().length + dots().length).toBe(2000);
    expect(pills().length).toBeLessThan(400);
  });
});

describe('listing map has no clusters (#546)', () => {
  it('never loads leaflet.markercluster', () => {
    expect((L as unknown as { markerClusterGroup?: unknown }).markerClusterGroup).toBeUndefined();
    for (const file of ['ListingsMapInner.tsx', 'PricePinLayer.tsx']) {
      const source = readFileSync(join(__dirname, file), 'utf8');
      expect(source).not.toMatch(/markercluster|markerClusterGroup|ServerClusters/);
    }
  });
});
