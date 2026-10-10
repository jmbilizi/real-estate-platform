/**
 * Spaces upstream Nominatim calls to the usage policy's limit: at most 1 request per second in
 * total (https://operations.osmfoundation.org/policies/nominatim/). One gate lives in each server
 * process. A call that would wait longer than `maxWaitMs` is refused instead of queued, so a burst
 * cannot build an unbounded backlog behind the limit (#781).
 */
export function createNominatimGate(
  options: {
    minIntervalMs?: number;
    maxWaitMs?: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
) {
  // 1.1 s, not 1 s, so clock jitter never puts two calls inside one second.
  const minIntervalMs = options.minIntervalMs ?? 1_100;
  const maxWaitMs = options.maxWaitMs ?? 4_000;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let nextSlotAt = 0;

  return {
    /** Resolves `true` when the caller may call upstream now, `false` when the queue is too long. */
    async acquire(): Promise<boolean> {
      const current = now();
      const start = Math.max(current, nextSlotAt);
      if (start - current > maxWaitMs) return false;
      nextSlotAt = start + minIntervalMs;
      if (start > current) await sleep(start - current);
      return true;
    },
  };
}

export type NominatimGate = ReturnType<typeof createNominatimGate>;
