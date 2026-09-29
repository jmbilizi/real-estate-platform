import { useSyncExternalStore } from 'react';

const MINUTE_MS = 60_000;

let current: number | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function tick(): void {
  current = Date.now();
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) {
    timer = setInterval(tick, MINUTE_MS);
  }
  // A card that mounts between ticks must not show a value older than the clock allows.
  if (current === null || Date.now() - current >= MINUTE_MS) {
    tick();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
      current = null;
    }
  };
}

const noopSubscribe = () => () => undefined;

/**
 * #459. Epoch ms, refreshed once a minute by one timer shared by every subscribed card.
 * `null` on the server and during hydration, so the first client render matches the server HTML.
 * Pass `enabled: false` to skip the timer for cards that need no minute precision.
 */
export function useMinuteClock(enabled: boolean): number | null {
  return useSyncExternalStore(
    enabled ? subscribe : noopSubscribe,
    () => (enabled ? current : null),
    () => null,
  );
}
