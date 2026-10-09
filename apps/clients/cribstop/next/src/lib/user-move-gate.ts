/**
 * Tells a map move the user made from a move the app made (#558).
 *
 * The map moves by itself when it fits the searched place, restores a shared view or opens a
 * popup. None of those may narrow the list. A user input (drag, wheel, pinch, zoom button, key)
 * marks intent. A move that ends soon after a mark is the user's. After it settles for
 * `debounceMs`, the gate reports the final view once. A new move restarts the wait.
 */
export interface UserMoveGate<View> {
  /** Call on every user input that can move the map. */
  markIntent: () => void;
  /** Call on the map's `moveend`. `read` returns the view at that moment. Returns true if the move is the user's. */
  moveEnd: (read: () => View) => boolean;
  /** Forgets the intent and any pending report. Use when the app starts its own move. */
  reset: () => void;
  dispose: () => void;
}

export interface UserMoveGateOptions<View> {
  onSettle: (view: View) => void;
  debounceMs?: number;
  /** How long after an input a `moveend` still counts as the user's. */
  intentWindowMs?: number;
  now?: () => number;
}

export const USER_MOVE_DEBOUNCE_MS = 400;
export const USER_MOVE_INTENT_WINDOW_MS = 1500;

export function createUserMoveGate<View>({
  onSettle,
  debounceMs = USER_MOVE_DEBOUNCE_MS,
  intentWindowMs = USER_MOVE_INTENT_WINDOW_MS,
  now = Date.now,
}: UserMoveGateOptions<View>): UserMoveGate<View> {
  let intentAt = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  return {
    markIntent: () => {
      intentAt = now();
    },
    moveEnd: (read) => {
      if (now() - intentAt > intentWindowMs) return false;
      cancel();
      timer = setTimeout(() => {
        timer = null;
        onSettle(read());
      }, debounceMs);
      return true;
    },
    reset: () => {
      intentAt = Number.NEGATIVE_INFINITY;
      cancel();
    },
    dispose: cancel,
  };
}

/** The zoom change, in levels, that counts as a new view (#746). */
export const ZOOM_SWITCH_DELTA = 0.5;

export interface MapMoveInput {
  /** The zoom of the last view that set or cleared the viewport filter, or of the initial fit. */
  committedZoom: number;
  zoom: number;
  bounds: { west: number; south: number; east: number; north: number };
  /** The current results as `[lat, lng]`, taken before the move. */
  points: readonly (readonly [number, number])[];
}

/**
 * Decides whether a settled user move switches the viewport filter on (#746). It does when the
 * zoom moved by `ZOOM_SWITCH_DELTA` or more, or when a pan left a current result outside the view.
 * A pan with no results never switches.
 */
export function shouldSwitchToMapView({
  committedZoom,
  zoom,
  bounds,
  points,
}: MapMoveInput): boolean {
  if (Math.abs(zoom - committedZoom) >= ZOOM_SWITCH_DELTA) return true;
  return points.some(
    ([lat, lng]) =>
      lat < bounds.south || lat > bounds.north || lng < bounds.west || lng > bounds.east,
  );
}
