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
  /** Call on the map's `moveend`. `read` returns the view at that moment. */
  moveEnd: (read: () => View) => void;
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
      if (now() - intentAt > intentWindowMs) return;
      cancel();
      timer = setTimeout(() => {
        timer = null;
        onSettle(read());
      }, debounceMs);
    },
    dispose: cancel,
  };
}
