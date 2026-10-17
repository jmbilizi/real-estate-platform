/** The one fixed "now" for specs that render relative or clock-dependent values. */
export const FIXED_NOW = new Date('2026-10-17T12:00:00.000Z');

/**
 * Pin the system clock to `FIXED_NOW` and leave timers real. TanStack Query and `waitFor`
 * keep working because only `Date` is faked. Call `restoreClock` in `afterEach`.
 */
export function pinClock(now: Date = FIXED_NOW): void {
  jest.useFakeTimers({
    doNotFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'setImmediate',
      'clearImmediate',
      'nextTick',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
      'performance',
    ],
    now,
  });
}

export function restoreClock(): void {
  jest.useRealTimers();
}
