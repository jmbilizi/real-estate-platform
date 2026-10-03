/**
 * Real Leaflet on jsdom, with `useMap` returning a real map. Canvas has no jsdom backend, so
 * `getContext` returns a recording stub. The tests read what the layer holds and what it draws.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { act, cleanup, render } from '@testing-library/react';
import L from 'leaflet';
import type { MapPin } from '@cribstop/property-contracts';

let mockMap: L.Map;
jest.mock('react-leaflet', () => ({ useMap: () => mockMap }));
jest.mock('@/components/MapPinCard', () => ({
  __esModule: true,
  default: ({ id, row }: { id: string; row?: unknown }) => (
    <div data-testid="pin-card" data-id={id} data-has-row={row ? 'yes' : 'no'} />
  ),
}));

import PricePinLayer from './PricePinLayer';
import { getListingPanel, resetListingPanel } from '@/lib/listing-panel';
import { aListingCardRow } from '@/test/fixtures';
import { formatListingPriceShort } from '@/lib/listing-format';
import { pillGeometry } from '@/lib/pill-draw';

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

/** What the canvas was asked to do, in order. */
let calls: Array<[string, unknown[]]> = [];
const recordingContext = new Proxy(
  {},
  {
    get:
      (_target, name: string) =>
      (...args: unknown[]) => {
        calls.push([name, args]);
      },
    set: () => true,
  },
);

let host: HTMLDivElement;

/**
 * jsdom can run a frame callback after `cancelAnimationFrame` removed it, when both sit in one
 * frame. Leaflet's canvas then redraws a renderer that is already gone. A browser does not.
 */
const redrawOfLiveRenderer = L.Canvas.prototype as unknown as { _redraw: () => void };

beforeEach(() => {
  const redraw = redrawOfLiveRenderer._redraw;
  jest.spyOn(redrawOfLiveRenderer, '_redraw').mockImplementation(function (this: {
    _ctx?: unknown;
  }) {
    if (this._ctx) redraw.call(this);
  });
  calls = [];
  resetListingPanel();
  jest
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockImplementation(() => recordingContext as unknown as CanvasRenderingContext2D);
  host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: 800 });
  Object.defineProperty(host, 'clientHeight', { value: 600 });
  document.body.appendChild(host);
  mockMap = L.map(host, { center: CENTER, zoom: 15 });
});

afterEach(() => {
  cleanup();
  mockMap.remove();
  host.remove();
  jest.restoreAllMocks();
});

type Pill = L.CircleMarker & {
  pin: MapPin;
  label: string;
  state: string;
  spread: { dx: number; dy: number; roomy: boolean; rank: number };
  _point: L.Point;
  _renderer: {
    _drawFirst: { layer: Pill; next: unknown } | null;
    _redraw: () => void;
    _redrawRequest: number | null;
  };
};

const pills = () => {
  const found: Pill[] = [];
  mockMap.eachLayer((layer) => {
    if ('pin' in layer && 'label' in layer) {
      found.push(layer as Pill);
    }
  });
  return found;
};
const pillOf = (id: string) => pills().find((p) => p.pin.id === id) as Pill;
/** Draw order, first drawn first. The last id is on top. */
const drawOrder = () => {
  const first = pills()[0];
  const ids: string[] = [];
  let node = first?._renderer._drawFirst as { layer: Pill; next: typeof node } | null | undefined;
  while (node) {
    ids.push(node.layer.pin.id);
    node = node.next;
  }
  return ids;
};
const popupCard = () => document.querySelector<HTMLElement>('[data-testid="pin-card"]');
const circles = () => {
  let count = 0;
  mockMap.eachLayer((layer) => {
    if (layer instanceof L.CircleMarker && !('pin' in layer)) count++;
  });
  return count;
};
const drawn = () => {
  calls = [];
  const renderer = pills()[0]?._renderer;
  if (renderer?._redrawRequest) L.Util.cancelAnimFrame(renderer._redrawRequest);
  renderer?._redraw();
  return calls;
};

function layer(pins: MapPin[], over: Partial<Parameters<typeof PricePinLayer>[0]> = {}) {
  return <PricePinLayer pins={pins} rowsById={new Map()} activeId={null} {...over} />;
}

describe('PricePinLayer (#546, #549)', () => {
  it('draws one pill per point with its price, and nothing as a dot, even where pills overlap', () => {
    const pins = [
      pin('a', 0, 0),
      pin('b', 0.00001, 0.00001),
      pin('c', 0.00002, 0),
      pin('d', 0.01, 0),
    ];
    render(layer(pins));

    expect(pills()).toHaveLength(pins.length);
    expect(circles()).toBe(0);
    const labels = drawn()
      .filter(([name]) => name === 'fillText')
      .map(([, args]) => args[0]);
    expect(labels).toEqual(pins.map(() => '$585K'));
  });

  it('writes the price from the card formatter family, never a different figure', () => {
    const pins = [
      pin('sale', 0, -0.006, { price: 585_000 }),
      pin('rent', 0, 0, { price: 2100, listingType: 'rent' }),
      pin('none', 0, 0.006, { price: null }),
    ];
    render(layer(pins));

    const labels = pins.map((p) => pillOf(p.id).label);
    expect(labels).toEqual(pins.map((p) => formatListingPriceShort(p.price, p.listingType).text));
    expect(labels).toEqual(['$585K', '$2.1K/mo', 'Withheld']);
  });

  it('puts the pointer tail tip on the exact coordinate', () => {
    const p = pin('a', 0, 0);
    render(layer([p]));

    const only = pills()[0];
    expect(only.getLatLng().lat).toBe(p.latitude);
    expect(only.getLatLng().lng).toBe(p.longitude);
    const g = pillGeometry(only._point.x, only._point.y, only.label, only.spread);
    // An unmoved pill has its tail tip on the point, and its body above it.
    expect([g.tailX, g.tailY]).toEqual([only._point.x, only._point.y]);
    expect(g.bottom).toBeLessThan(g.tailY);
  });

  it('puts the hovered pill on top of an overlapping pill, and drops it back after', () => {
    const onMarkerHover = jest.fn();
    // `low` is lower on screen, so by default it covers `high`.
    const pins = [pin('high', 0.00002, 0), pin('low', 0, 0)];
    render(layer(pins, { onMarkerHover }));
    expect(drawOrder()).toEqual(['high', 'low']);

    act(() => {
      pillOf('high').fire('mouseover', {}, true);
    });
    expect(drawOrder()).toEqual(['low', 'high']);
    expect(pillOf('high').state).toBe('active');
    expect(onMarkerHover).toHaveBeenLastCalledWith('high');

    act(() => {
      pillOf('high').fire('mouseout', {}, true);
    });
    expect(drawOrder()).toEqual(['high', 'low']);
    expect(pillOf('high').state).toBe('plain');
    expect(onMarkerHover).toHaveBeenLastCalledWith(null);
  });

  it('puts the pill of the highlighted card on top', () => {
    const pins = [pin('high', 0.00002, 0), pin('low', 0, 0)];
    const { rerender } = render(layer(pins));
    rerender(layer(pins, { activeId: 'high' }));

    expect(drawOrder().at(-1)).toBe('high');
    rerender(layer(pins, { activeId: null }));
    expect(drawOrder()).toEqual(['high', 'low']);
  });

  it('draws the hovered pill in the brand red, with no text but its price', () => {
    render(layer([pin('a', 0, 0)]));
    act(() => {
      pillOf('a').fire('mouseover', {}, true);
    });

    const calls2 = drawn();
    const fills = calls2.filter(([name]) => name === 'fillText');
    expect(fills).toHaveLength(1);
    expect(fills[0][1][0]).toBe('$585K');
    expect(JSON.stringify(calls2)).not.toContain('title');
  });

  it('marks a saved pill without raising it, so no pill loses its visible strip', () => {
    const pins = [pin('saved', 0.00002, 0), pin('plain', 0, 0)];
    render(layer(pins, { savedIds: new Set(['saved']) }));

    expect(pillOf('saved').state).toBe('saved');
    // The stable screen order holds: the lower pill is on top.
    expect(drawOrder()).toEqual(['saved', 'plain']);
  });

  it('keeps the stacking order through a pan and a refetch', () => {
    const pins = [pin('a', 0.00004, 0), pin('b', 0.00002, 0), pin('c', 0, 0)];
    const { rerender } = render(layer(pins));
    const before = drawOrder();

    act(() => {
      mockMap.panBy([120, 80], { animate: false });
    });
    // A refetch returns the same homes plus a new one. Existing pills are reused.
    const reused = pills();
    rerender(layer([...pins, pin('d', 0.00006, 0)]));

    expect(drawOrder().filter((id) => before.includes(id))).toEqual(before);
    for (const p of reused) expect(pills()).toContain(p);
  });

  it('adds and removes only the pills that changed on a refetch', () => {
    const pins = [pin('a', 0, -0.004), pin('b', 0, 0), pin('c', 0, 0.004)];
    const { rerender } = render(layer(pins));
    const keptB = pillOf('b');

    rerender(layer([pins[1], pin('d', 0.003, 0.003)]));

    expect(pills()).toHaveLength(2);
    expect(pills()).toContain(keptB);
  });

  it('fans homes at one coordinate out, each with its tail on the shared point', () => {
    const units = Array.from({ length: 24 }, (_, i) => pin(`unit${i}`, 0, 0));
    render(layer(units));

    const spots = new Set(pills().map((p) => `${p.spread.dx},${p.spread.dy}`));
    expect(spots.size).toBe(24);
    // Every pill is on the shared coordinate. Only the body moves.
    for (const p of pills()) {
      expect(p.getLatLng().lat).toBe(units[0].latitude);
      expect(p.getLatLng().lng).toBe(units[0].longitude);
    }
    // A moved pill draws its leader line and a dot on the true point.
    const names = drawn().map(([name]) => name);
    expect(names.filter((name) => name === 'arc')).toHaveLength(23);
  });

  it('opens each pill of a stack on click, not just the top one', async () => {
    const pins = [pin('u1', 0, 0), pin('u2', 0, 0), pin('u3', 0, 0)];
    render(layer(pins));

    const opened: Array<string | null> = [];
    for (const p of pills()) {
      await act(async () => {
        p.fire('click', {}, true);
      });
      opened.push(popupCard()?.getAttribute('data-id') ?? null);
    }
    expect(opened.sort()).toEqual(['u1', 'u2', 'u3']);
  });

  it('re-spreads when the zoom changes', () => {
    // 0.0003 deg is about 9px apart at zoom 15, so the pair collides, and about 290px at zoom 20.
    const pins = [pin('a', 0, 0), pin('b', 0.0003, 0)];
    render(layer(pins));
    const moved = () => pills().filter((p) => p.spread.dx !== 0 || p.spread.dy !== 0).length;
    expect(moved()).toBe(1);

    jest.useFakeTimers();
    try {
      act(() => {
        mockMap.setZoom(20, { animate: false });
        // The layout waits briefly for the refetch that follows a zoom.
        jest.advanceTimersByTime(1000);
      });
    } finally {
      jest.useRealTimers();
    }
    expect(moved()).toBe(0);
  });

  it('opens the card popup, not the listing panel, for a pin that is not on the page', async () => {
    const pins = [pin('first', 0, 0)];
    render(layer(pins));

    await act(async () => {
      pillOf('first').fire('click', {}, true);
    });

    expect(popupCard()?.getAttribute('data-id')).toBe('first');
    expect(popupCard()?.getAttribute('data-has-row')).toBe('no');
    expect(getListingPanel()).toBeNull();
  });

  it('hands the page row to the popup for a pin that is on the page', async () => {
    const pins = [pin('first', 0, 0)];
    render(layer(pins, { rowsById: new Map([['first', aListingCardRow({ id: 'first' })]]) }));

    await act(async () => {
      pillOf('first').fire('click', {}, true);
    });

    expect(popupCard()?.getAttribute('data-has-row')).toBe('yes');
    expect(getListingPanel()).toBeNull();
  });

  it('clears the hover when the hovered pill leaves the map', () => {
    const onMarkerHover = jest.fn();
    const pins = [pin('a', 0, 0), pin('b', 0, 0.004)];
    const { rerender } = render(layer(pins, { onMarkerHover }));
    act(() => {
      pillOf('a').fire('mouseover', {}, true);
    });

    rerender(layer([pins[1]], { onMarkerHover }));
    expect(onMarkerHover).toHaveBeenLastCalledWith(null);
  });

  it('finds the pill under the pointer on the canvas, and the top pill where two overlap', () => {
    const onMarkerHover = jest.fn();
    const pins = [pin('under', 0.00002, 0), pin('top', 0, 0)];
    render(layer(pins, { onMarkerHover }));
    const top = pillOf('top');
    const g = pillGeometry(top._point.x, top._point.y, top.label, top.spread);
    // A point inside the bodies of both pills, shifted from layer to container pixels.
    const inBoth = mockMap.layerPointToContainerPoint(L.point(g.tailX, g.top + 14));
    const canvas = host.querySelector('canvas') as HTMLCanvasElement;

    act(() => {
      canvas.dispatchEvent(
        new MouseEvent('mousemove', { clientX: inBoth.x, clientY: inBoth.y, bubbles: true }),
      );
    });

    // `top` is lower on screen and drawn last, so it takes the hit.
    expect(onMarkerHover).toHaveBeenLastCalledWith('top');
  });

  it('removes every pill on unmount', () => {
    const { unmount } = render(layer([pin('a', 0, -0.004), pin('b', 0, 0.004)]));
    unmount();

    expect(pills()).toHaveLength(0);
  });

  it('draws 1,800 points as 1,800 pills, each with its price', () => {
    const many = Array.from({ length: 1800 }, (_, i) =>
      pin(`p${i}`, ((i * 7919) % 1000) / 100_000, ((i * 104_729) % 1000) / 100_000),
    );
    render(layer(many));

    expect(pills()).toHaveLength(1800);
    expect(circles()).toBe(0);
    const labels = drawn().filter(([name]) => name === 'fillText');
    expect(labels).toHaveLength(1800);
  });
});

describe('listing map has no clusters, no dots and no DOM markers (#546, #549)', () => {
  const source = (file: string) => readFileSync(join(__dirname, file), 'utf8');

  it('never loads leaflet.markercluster', () => {
    expect((L as unknown as { markerClusterGroup?: unknown }).markerClusterGroup).toBeUndefined();
    for (const file of ['ListingsMapInner.tsx', 'PricePinLayer.tsx']) {
      expect(source(file)).not.toMatch(/markercluster|markerClusterGroup|ServerClusters/);
    }
  });

  it('PricePinLayer makes no dot markers and no DOM markers', () => {
    expect(source('PricePinLayer.tsx')).not.toMatch(/L\.circleMarker\(|L\.marker\(|divIcon/);
  });

  it('leaves NeighborhoodMapLayer unchanged', () => {
    expect(source('NeighborhoodMapLayer.tsx')).not.toMatch(/PricePinLayer|map-pins|pill-draw/);
  });
});
