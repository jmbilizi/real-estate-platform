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

import PricePinLayer, { FAN_MIN_ZOOM } from './PricePinLayer';
import { getListingPanel, resetListingPanel } from '@/lib/listing-panel';
import { aListingCardRow } from '@/test/fixtures';
import { formatListingPriceShort } from '@/lib/listing-format';
import { FAN_CAP_PX } from '@/lib/map-pins';

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
  delete (window as unknown as { matchMedia?: unknown }).matchMedia;
  cleanup();
  mockMap.remove();
  host.remove();
  jest.restoreAllMocks();
});

type Pill = L.CircleMarker & {
  pin: MapPin;
  label: string;
  state: string;
  offset: { dx: number; dy: number };
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

/** Moves the pointer to a layer point, as the canvas receives it. */
function pointerAt(layerPoint: L.Point) {
  const at = mockMap.layerPointToContainerPoint(layerPoint);
  const canvas = host.querySelector('canvas') as HTMLCanvasElement;
  act(() => {
    canvas.dispatchEvent(
      new MouseEvent('mousemove', { clientX: at.x, clientY: at.y, bubbles: true }),
    );
  });
}

describe('PricePinLayer (#557)', () => {
  it('draws one pin per home with no price text at rest, and no circle markers', () => {
    const pins = [
      pin('a', 0, 0),
      pin('b', 0.00001, 0.00001),
      pin('c', 0.00002, 0),
      pin('d', 0.01, 0),
    ];
    render(layer(pins));

    expect(pills()).toHaveLength(pins.length);
    expect(circles()).toBe(0);
    const recorded = drawn();
    expect(recorded.some(([name]) => name === 'fillText')).toBe(false);
    // One teardrop path per home, and each starts at the coordinate.
    const tips = recorded.filter(([name]) => name === 'moveTo').map(([, args]) => args);
    expect(tips).toHaveLength(pins.length);
    for (const p of pills()) expect(tips).toContainEqual([p._point.x, p._point.y]);
  });

  it('puts the pin tip on the exact coordinate', () => {
    const p = pin('a', 0, 0);
    render(layer([p]));

    const only = pills()[0];
    expect(only.getLatLng().lat).toBe(p.latitude);
    expect(only.getLatLng().lng).toBe(p.longitude);
    expect(only.offset).toEqual({ dx: 0, dy: 0 });
  });

  it('shows the red price pill when the pointer hovers a pin, and a pin again after', () => {
    const onMarkerHover = jest.fn();
    render(layer([pin('a', 0, 0), pin('b', 0, 0.004)], { onMarkerHover }));

    act(() => {
      pillOf('a').fire('mouseover', {}, true);
    });
    expect(pillOf('a').state).toBe('active');
    expect(onMarkerHover).toHaveBeenLastCalledWith('a');
    const texts = drawn().filter(([name]) => name === 'fillText');
    expect(texts.map(([, args]) => args[0])).toEqual(['$585K']);

    act(() => {
      pillOf('a').fire('mouseout', {}, true);
    });
    expect(pillOf('a').state).toBe('plain');
    expect(onMarkerHover).toHaveBeenLastCalledWith(null);
    expect(drawn().some(([name]) => name === 'fillText')).toBe(false);
  });

  it('writes the price from the card formatter family', () => {
    const pins = [
      pin('sale', 0, -0.006, { price: 585_000 }),
      pin('rent', 0, 0, { price: 2100, listingType: 'rent' }),
      pin('none', 0, 0.006, { price: null }),
    ];
    render(layer(pins));
    for (const id of ['sale', 'rent', 'none']) {
      act(() => {
        pillOf(id).fire('mouseover', {}, true);
      });
    }

    const labels = pins.map((p) => pillOf(p.id).label);
    expect(labels).toEqual(pins.map((p) => formatListingPriceShort(p.price, p.listingType).text));
    expect(labels).toEqual(['$585K', '$2.1K/mo', 'Withheld']);
  });

  it('shows the pill of the hovered listing card, on top, and a pin again after', () => {
    const pins = [pin('high', 0.00002, 0), pin('low', 0, 0)];
    const { rerender } = render(layer(pins));
    expect(drawOrder()).toEqual(['high', 'low']);

    rerender(layer(pins, { activeId: 'high' }));
    expect(pillOf('high').state).toBe('active');
    expect(drawOrder().at(-1)).toBe('high');

    rerender(layer(pins, { activeId: null }));
    expect(pillOf('high').state).toBe('plain');
    expect(drawOrder()).toEqual(['high', 'low']);
  });

  it('marks a saved pin, and a hover on it still shows the pill', () => {
    const pins = [pin('saved', 0.00002, 0), pin('plain', 0, 0)];
    render(layer(pins, { savedIds: new Set(['saved']) }));

    expect(pillOf('saved').state).toBe('saved');
    expect(pillOf('plain').state).toBe('plain');
    act(() => {
      pillOf('saved').fire('mouseover', {}, true);
    });
    expect(pillOf('saved').state).toBe('active');
  });

  it('opens the card popup on click and shows the pill of the selected pin until it closes', async () => {
    render(layer([pin('first', 0, 0), pin('second', 0, 0.004)]));

    await act(async () => {
      pillOf('first').fire('click', {}, true);
    });
    expect(popupCard()?.getAttribute('data-id')).toBe('first');
    expect(getListingPanel()).toBeNull();
    expect(pillOf('first').state).toBe('active');

    await act(async () => {
      pillOf('second').fire('click', {}, true);
    });
    expect(popupCard()?.getAttribute('data-id')).toBe('second');
    expect(pillOf('first').state).toBe('plain');
    expect(pillOf('second').state).toBe('active');

    await act(async () => {
      mockMap.closePopup();
    });
    expect(pillOf('second').state).toBe('plain');
  });

  it('hands the page row to the popup for a pin on the page, and none for one off it', async () => {
    render(
      layer([pin('on', 0, 0), pin('off', 0, 0.004)], {
        rowsById: new Map([['on', aListingCardRow({ id: 'on' })]]),
      }),
    );

    await act(async () => {
      pillOf('on').fire('click', {}, true);
    });
    expect(popupCard()?.getAttribute('data-has-row')).toBe('yes');
    await act(async () => {
      pillOf('off').fire('click', {}, true);
    });
    expect(popupCard()?.getAttribute('data-has-row')).toBe('no');
  });

  it('opens a popup on tap and shows no hover pill when the device has no hover', async () => {
    const onMarkerHover = jest.fn();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({ matches: query === '(hover: none)', media: query }),
    });
    render(layer([pin('a', 0, 0)], { onMarkerHover }));

    act(() => {
      pillOf('a').fire('mouseover', {}, true);
    });
    expect(pillOf('a').state).toBe('plain');
    expect(onMarkerHover).not.toHaveBeenCalled();
    await act(async () => {
      pillOf('a').fire('click', {}, true);
    });
    expect(popupCard()?.getAttribute('data-id')).toBe('a');
    expect(pillOf('a').state).toBe('active');
  });

  it('gives the pointer to the topmost drawn pin where two hit boxes overlap', () => {
    const onMarkerHover = jest.fn();
    // `top` is lower on screen, so it is drawn last. Both hit boxes hold the probe point.
    render(layer([pin('under', 0.00002, 0), pin('top', 0, 0)], { onMarkerHover }));
    const top = pillOf('top');
    expect(drawOrder()).toEqual(['under', 'top']);

    pointerAt(L.point(top._point.x, top._point.y - 8));

    expect(onMarkerHover).toHaveBeenLastCalledWith('top');
  });

  it('reaches the pin below when the pointer is outside the pin on top', () => {
    const onMarkerHover = jest.fn();
    render(layer([pin('under', 0.002, 0), pin('top', 0, 0)], { onMarkerHover }));
    const under = pillOf('under');

    pointerAt(L.point(under._point.x, under._point.y - 8));

    expect(onMarkerHover).toHaveBeenLastCalledWith('under');
  });

  it('keeps the draw order through a pan and a refetch', () => {
    const pins = [pin('a', 0.00004, 0), pin('b', 0.00002, 0), pin('c', 0, 0)];
    const { rerender } = render(layer(pins));
    const before = drawOrder();

    act(() => {
      mockMap.panBy([120, 80], { animate: false });
    });
    const reused = pills();
    rerender(layer([...pins, pin('d', 0.00006, 0)]));

    expect(drawOrder().filter((id) => before.includes(id))).toEqual(before);
    for (const p of reused) expect(pills()).toContain(p);
  });

  it('adds and removes only the pins that changed on a refetch', () => {
    const pins = [pin('a', 0, -0.004), pin('b', 0, 0), pin('c', 0, 0.004)];
    const { rerender } = render(layer(pins));
    const keptB = pillOf('b');

    rerender(layer([pins[1], pin('d', 0.003, 0.003)]));

    expect(pills()).toHaveLength(2);
    expect(pills()).toContain(keptB);
  });

  it('clears the hover when the hovered pin leaves the map', () => {
    const onMarkerHover = jest.fn();
    const pins = [pin('a', 0, 0), pin('b', 0, 0.004)];
    const { rerender } = render(layer(pins, { onMarkerHover }));
    act(() => {
      pillOf('a').fire('mouseover', {}, true);
    });

    rerender(layer([pins[1]], { onMarkerHover }));
    expect(onMarkerHover).toHaveBeenLastCalledWith(null);
  });

  it('fans homes at one true coordinate out at zoom 17 and higher, each tip within the cap', () => {
    mockMap.setZoom(18, { animate: false });
    const units = Array.from({ length: 24 }, (_, i) => pin(`unit${i}`, 0, 0));
    render(layer(units));

    const spots = new Set(pills().map((p) => `${p.offset.dx},${p.offset.dy}`));
    expect(spots.size).toBe(24);
    for (const p of pills()) {
      expect(p.getLatLng().lat).toBe(units[0].latitude);
      expect(Math.hypot(p.offset.dx, p.offset.dy)).toBeLessThanOrEqual(FAN_CAP_PX + 1);
    }
    // A fanned pin draws a leader line and a dot on the true point.
    expect(drawn().filter(([name]) => name === 'arc').length).toBeGreaterThanOrEqual(23);
  });

  it('does not fan homes below zoom 17, and does not move homes that only sit close', () => {
    const units = Array.from({ length: 24 }, (_, i) => pin(`unit${i}`, 0, 0));
    render(layer([...units, pin('near', 0.00002, 0)]));

    for (const p of pills()) expect(p.offset).toEqual({ dx: 0, dy: 0 });
    expect(FAN_MIN_ZOOM).toBe(17);
  });

  it('fans at the zoom change, and folds back below zoom 17', () => {
    const units = Array.from({ length: 6 }, (_, i) => pin(`unit${i}`, 0, 0));
    const moved = () => pills().filter((p) => p.offset.dx !== 0 || p.offset.dy !== 0).length;
    render(layer([...units, pin('near', 0.00002, 0)]));
    expect(moved()).toBe(0);

    act(() => {
      mockMap.setZoom(18, { animate: false });
    });
    expect(moved()).toBe(5);

    act(() => {
      mockMap.setZoom(15, { animate: false });
    });
    expect(moved()).toBe(0);
  });

  it('opens each pin of a fanned stack on click', async () => {
    mockMap.setZoom(18, { animate: false });
    render(layer([pin('u1', 0, 0), pin('u2', 0, 0), pin('u3', 0, 0)]));

    const opened: Array<string | null> = [];
    for (const p of pills()) {
      await act(async () => {
        p.fire('click', {}, true);
      });
      opened.push(popupCard()?.getAttribute('data-id') ?? null);
    }
    expect(opened.sort()).toEqual(['u1', 'u2', 'u3']);
  });

  it('removes every pin on unmount', () => {
    const { unmount } = render(layer([pin('a', 0, -0.004), pin('b', 0, 0.004)]));
    unmount();

    expect(pills()).toHaveLength(0);
  });

  it('draws 1,800 homes as 1,800 pins with no price text', () => {
    const many = Array.from({ length: 1800 }, (_, i) =>
      pin(`p${i}`, ((i * 7919) % 1000) / 100_000, ((i * 104_729) % 1000) / 100_000),
    );
    render(layer(many));

    expect(pills()).toHaveLength(1800);
    expect(circles()).toBe(0);
    const recorded = drawn();
    expect(recorded.filter(([name]) => name === 'moveTo')).toHaveLength(1800);
    expect(recorded.some(([name]) => name === 'fillText')).toBe(false);
  });
});

describe('listing map has no clusters, no dots and no DOM markers (#546, #549, #557)', () => {
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
    expect(source('NeighborhoodMapLayer.tsx')).not.toMatch(
      /PricePinLayer|map-pins|pin-draw|pill-draw/,
    );
  });
});
