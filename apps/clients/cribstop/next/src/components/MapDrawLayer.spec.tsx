/**
 * #747. The draw surface: the gesture, the pan lock, cancel, and the notices. Leaflet does not run
 * under jsdom, so the map is a stand-in with real enable/disable state.
 */
const handler = (on: boolean) => {
  const state = { on };
  return {
    state,
    enabled: () => state.on,
    enable: () => {
      state.on = true;
    },
    disable: () => {
      state.on = false;
    },
  };
};
const fakeMap = {
  dragging: handler(true),
  touchZoom: handler(true),
  doubleClickZoom: handler(true),
  // One CSS pixel is 0.001 degree. The origin is 38, -77.
  containerPointToLatLng: ([x, y]: [number, number]) => ({
    lng: -77 + x / 1000,
    lat: 38 - y / 1000,
  }),
};
jest.mock('react-leaflet', () => ({ useMap: () => fakeMap }));

import { fireEvent, render, screen } from '@testing-library/react';
import MapDrawLayer, { type DrawOutcome } from './MapDrawLayer';
import type { LngLat } from '@/lib/draw-area';

// jsdom has no PointerEvent. Without one, `fireEvent` drops the coordinates and the pointer id.
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventStandIn extends MouseEvent {
    readonly pointerId: number;
    readonly isPrimary: boolean;
    constructor(type: string, init: MouseEventInit & { pointerId?: number; isPrimary?: boolean }) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.isPrimary = init.isPrimary ?? true;
    }
  }
  window.PointerEvent = PointerEventStandIn as unknown as typeof PointerEvent;
}

type Pointer = {
  pointerId?: number;
  clientX: number;
  clientY: number;
  isPrimary?: boolean;
  button?: number;
};
const pointer = (init: Pointer) => ({ pointerId: 1, isPrimary: true, ...init });

/** A press, a drag through `points` and a release, as a finger makes them. */
function drag(points: [number, number][]) {
  const surface = screen.getByTestId('draw-surface');
  const [first, ...rest] = points as [[number, number], ...[number, number][]];
  fireEvent.pointerDown(surface, pointer({ clientX: first[0], clientY: first[1] }));
  for (const [x, y] of rest) fireEvent.pointerMove(surface, pointer({ clientX: x, clientY: y }));
  const last = points[points.length - 1] as [number, number];
  fireEvent.pointerUp(surface, pointer({ clientX: last[0], clientY: last[1] }));
}

const SQUARE: [number, number][] = [
  [20, 20],
  [120, 20],
  [120, 120],
  [20, 120],
];

describe('MapDrawLayer', () => {
  beforeEach(() => {
    fakeMap.dragging.state.on = true;
    fakeMap.touchZoom.state.on = true;
    fakeMap.doubleClickZoom.state.on = true;
  });

  it('disables pan, touch zoom and double-click zoom while it is mounted, then restores them', () => {
    const { unmount } = render(<MapDrawLayer onFinish={() => 'ok'} onCancel={jest.fn()} />);

    expect(fakeMap.dragging.state.on).toBe(false);
    expect(fakeMap.touchZoom.state.on).toBe(false);
    expect(fakeMap.doubleClickZoom.state.on).toBe(false);

    unmount();
    expect(fakeMap.dragging.state.on).toBe(true);
    expect(fakeMap.touchZoom.state.on).toBe(true);
    expect(fakeMap.doubleClickZoom.state.on).toBe(true);
  });

  it('gives the surface touch-action none so a finger draws and never scrolls the page', () => {
    render(<MapDrawLayer onFinish={() => 'ok'} onCancel={jest.fn()} />);
    expect(screen.getByTestId('draw-surface').style.touchAction).toBe('none');
  });

  it('reports the dragged loop as map coordinates when the pointer is released', () => {
    const onFinish = jest.fn<DrawOutcome, [readonly LngLat[]]>(() => 'ok');
    render(<MapDrawLayer onFinish={onFinish} onCancel={jest.fn()} />);

    drag(SQUARE);

    expect(onFinish).toHaveBeenCalledTimes(1);
    const path = onFinish.mock.calls[0]?.[0] as LngLat[];
    expect(path).toHaveLength(4);
    expect(path[0]?.[0]).toBeCloseTo(-76.98, 5);
    expect(path[0]?.[1]).toBeCloseTo(37.98, 5);
    expect(path[2]?.[0]).toBeCloseTo(-76.88, 5);
  });

  it('draws a preview while the pointer is down and removes it on release', () => {
    render(<MapDrawLayer onFinish={() => 'ok'} onCancel={jest.fn()} />);
    const surface = screen.getByTestId('draw-surface');

    fireEvent.pointerDown(surface, pointer({ clientX: 20, clientY: 20 }));
    fireEvent.pointerMove(surface, pointer({ clientX: 80, clientY: 20 }));
    expect(screen.getByTestId('draw-preview')).toBeTruthy();

    fireEvent.pointerUp(surface, pointer({ clientX: 80, clientY: 20 }));
    expect(screen.queryByTestId('draw-preview')).toBeNull();
  });

  it('shows a notice and stays on for a shape that is too small', () => {
    render(<MapDrawLayer onFinish={() => 'too-small'} onCancel={jest.fn()} />);
    drag([[20, 20]]);

    expect(screen.getByTestId('draw-hint').textContent).toMatch(/too small/i);
    expect(fakeMap.dragging.state.on).toBe(false);
  });

  it('shows a notice for a line that crosses itself', () => {
    render(<MapDrawLayer onFinish={() => 'crossed'} onCancel={jest.fn()} />);
    drag(SQUARE);
    expect(screen.getByTestId('draw-hint').textContent).toMatch(/crosses itself/i);
  });

  it('cancels from the on-screen Cancel button and from Escape', () => {
    const onCancel = jest.fn();
    render(<MapDrawLayer onFinish={() => 'ok'} onCancel={onCancel} />);

    fireEvent.click(screen.getByTestId('draw-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('ignores a right click, which opens a menu and never sends a release', () => {
    const onFinish = jest.fn<DrawOutcome, [readonly LngLat[]]>(() => 'ok');
    render(<MapDrawLayer onFinish={onFinish} onCancel={jest.fn()} />);
    const surface = screen.getByTestId('draw-surface');

    fireEvent.pointerDown(surface, pointer({ clientX: 20, clientY: 20, button: 2 }));
    fireEvent.pointerUp(surface, pointer({ clientX: 20, clientY: 20, button: 2 }));
    drag(SQUARE);

    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('draws nothing from a second finger', () => {
    const onFinish = jest.fn<DrawOutcome, [readonly LngLat[]]>(() => 'ok');
    render(<MapDrawLayer onFinish={onFinish} onCancel={jest.fn()} />);
    const surface = screen.getByTestId('draw-surface');

    fireEvent.pointerDown(surface, pointer({ clientX: 20, clientY: 20 }));
    fireEvent.pointerDown(
      surface,
      pointer({ pointerId: 2, isPrimary: false, clientX: 90, clientY: 90 }),
    );
    fireEvent.pointerUp(
      surface,
      pointer({ pointerId: 2, isPrimary: false, clientX: 90, clientY: 90 }),
    );
    expect(onFinish).not.toHaveBeenCalled();
  });
});
