import type { LngLat } from '@/lib/draw-area';

/**
 * The freehand draw gesture (#747), without Leaflet or the DOM, so a test can drive it. The map
 * layer feeds it pointer events and draws what `onChange` reports.
 */

/** A Leaflet interaction handler, as far as this file needs it. */
interface Handler {
  enabled: () => boolean;
  enable: () => void;
  disable: () => void;
}

/** The handlers that move the map. Draw mode turns each one off and restores it on exit. */
export interface LockableMap {
  dragging: Handler;
  touchZoom: Handler;
  doubleClickZoom: Handler;
  scrollWheelZoom?: Handler;
  boxZoom?: Handler;
  keyboard?: Handler;
}

/** Disables every interaction handler that is on. The returned function restores exactly those. */
export function lockMapInteraction(map: LockableMap): () => void {
  const handlers = [
    map.dragging,
    map.touchZoom,
    map.doubleClickZoom,
    map.scrollWheelZoom,
    map.boxZoom,
    map.keyboard,
  ].filter((handler): handler is Handler => handler !== undefined && handler.enabled());
  for (const handler of handlers) handler.disable();
  return () => {
    for (const handler of handlers) handler.enable();
  };
}

export interface DrawPointer {
  pointerId: number;
  clientX: number;
  clientY: number;
  /** False for a second finger. */
  isPrimary?: boolean;
}

/** A move under this many CSS pixels is jitter, not a new point. */
const MIN_STEP_PX = 3;

export interface DrawGestureOptions {
  toLngLat: (clientX: number, clientY: number) => LngLat;
  /** The path so far, after each new point. */
  onChange: (path: readonly LngLat[]) => void;
  /** The finger or mouse came up. */
  onFinish: (path: readonly LngLat[]) => void;
}

export interface DrawGesture {
  down: (event: DrawPointer) => boolean;
  move: (event: DrawPointer) => void;
  up: (event: DrawPointer) => void;
  /** The pointer was taken away (a system gesture, a lost capture). Nothing is applied. */
  cancel: () => void;
}

export function createDrawGesture({
  toLngLat,
  onChange,
  onFinish,
}: DrawGestureOptions): DrawGesture {
  let pointerId: number | null = null;
  let path: LngLat[] = [];
  let lastX = 0;
  let lastY = 0;

  const add = (event: DrawPointer) => {
    path.push(toLngLat(event.clientX, event.clientY));
    lastX = event.clientX;
    lastY = event.clientY;
    onChange(path);
  };
  const reset = () => {
    pointerId = null;
    path = [];
  };

  return {
    down(event) {
      // One pointer draws. A second finger never starts a second line.
      if (pointerId !== null || event.isPrimary === false) return false;
      pointerId = event.pointerId;
      path = [];
      add(event);
      return true;
    },
    move(event) {
      if (event.pointerId !== pointerId) return;
      if (Math.hypot(event.clientX - lastX, event.clientY - lastY) < MIN_STEP_PX) return;
      add(event);
    },
    up(event) {
      if (event.pointerId !== pointerId) return;
      const finished = path;
      reset();
      onFinish(finished);
    },
    cancel() {
      if (pointerId === null) return;
      reset();
      onChange([]);
    },
  };
}
