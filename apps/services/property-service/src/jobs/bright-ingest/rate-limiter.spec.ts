import { backoffDelayMs, isRetryableStatus, RateLimiter } from './rate-limiter';

/**
 * A virtual clock. The limiter only ever reads `now()` and waits through `sleep()`, so advancing the
 * clock inside `sleep` reproduces real pacing with no elapsed time. Without this, asserting a
 * one-minute ceiling would take a minute.
 */
function virtualClock(): { now: () => number; sleep: (ms: number) => Promise<void> } {
  let at = 0;
  return {
    now: () => at,
    sleep: (ms: number) => {
      at += ms;
      return Promise.resolve();
    },
  };
}

/** The ceiling the job must never break, measured the way a server would measure it. */
function maxInAnyWindow(starts: readonly number[], windowMs: number): number {
  let worst = 0;
  for (const start of starts) {
    const inWindow = starts.filter((other) => other >= start && other < start + windowMs).length;
    worst = Math.max(worst, inWindow);
  }
  return worst;
}

describe('RateLimiter — the ceiling holds', () => {
  it('never starts more than the per-second limit inside any one-second window', async () => {
    const clock = virtualClock();
    const limiter = new RateLimiter(
      { requestsPerSecond: 3, requestsPerMinute: 10_000, maxConcurrency: 1 },
      clock,
    );
    const starts: number[] = [];

    for (let i = 0; i < 30; i += 1) {
      await limiter.schedule(() => {
        starts.push(clock.now());
        return Promise.resolve(i);
      });
    }

    expect(starts).toHaveLength(30);
    expect(maxInAnyWindow(starts, 1_000)).toBeLessThanOrEqual(3);
  });

  it('never starts more than the per-minute limit inside any one-minute window', async () => {
    const clock = virtualClock();
    const limiter = new RateLimiter(
      { requestsPerSecond: 50, requestsPerMinute: 20, maxConcurrency: 1 },
      clock,
    );
    const starts: number[] = [];

    for (let i = 0; i < 45; i += 1) {
      await limiter.schedule(() => {
        starts.push(clock.now());
        return Promise.resolve(i);
      });
    }

    expect(maxInAnyWindow(starts, 60_000)).toBeLessThanOrEqual(20);
  });

  /**
   * A full resync is the case the ceiling matters most in, and it is also the case a token bucket
   * gets wrong: an idle bucket is full, so the first N requests of a backfill arrive together.
   */
  it('holds the ceiling from the very first request, with no starting burst', async () => {
    const clock = virtualClock();
    const limiter = new RateLimiter(
      { requestsPerSecond: 2, requestsPerMinute: 60, maxConcurrency: 1 },
      clock,
    );
    const starts: number[] = [];

    for (let i = 0; i < 12; i += 1) {
      await limiter.schedule(() => {
        starts.push(clock.now());
        return Promise.resolve();
      });
    }

    expect(maxInAnyWindow(starts, 1_000)).toBeLessThanOrEqual(2);
  });

  /**
   * Concurrent callers are the interesting case: two callers that both read the window and both
   * decide to go is how a limiter silently doubles the rate it was given.
   */
  it('holds the ceiling when callers arrive together', async () => {
    const clock = virtualClock();
    const limiter = new RateLimiter(
      { requestsPerSecond: 2, requestsPerMinute: 1_000, maxConcurrency: 4 },
      clock,
    );
    const starts: number[] = [];

    await Promise.all(
      Array.from({ length: 20 }, () =>
        limiter.schedule(() => {
          starts.push(clock.now());
          return Promise.resolve();
        }),
      ),
    );

    expect(starts).toHaveLength(20);
    expect(maxInAnyWindow(starts, 1_000)).toBeLessThanOrEqual(2);
  });

  it('never runs more operations at once than the concurrency limit', async () => {
    const clock = virtualClock();
    const limiter = new RateLimiter(
      { requestsPerSecond: 1_000, requestsPerMinute: 10_000, maxConcurrency: 2 },
      clock,
    );
    let inFlight = 0;
    let peak = 0;
    let open = () => undefined as void;
    // Every operation blocks on one gate, so the slots are genuinely held while the rest queue.
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });

    const running = Array.from({ length: 6 }, () =>
      limiter.schedule(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await gate;
        inFlight -= 1;
      }),
    );

    await new Promise((resolve) => setImmediate(resolve));
    expect(inFlight).toBe(2);

    open();
    await Promise.all(running);
    expect(peak).toBe(2);
  });

  it('releases its slot when an operation rejects', async () => {
    const clock = virtualClock();
    const limiter = new RateLimiter(
      { requestsPerSecond: 100, requestsPerMinute: 1_000, maxConcurrency: 1 },
      clock,
    );

    await expect(limiter.schedule(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(limiter.schedule(() => Promise.resolve('next'))).resolves.toBe('next');
  });

  it('rejects a ceiling that is not a positive integer', () => {
    expect(
      () => new RateLimiter({ requestsPerSecond: 0, requestsPerMinute: 60, maxConcurrency: 1 }),
    ).toThrow(/positive integer/);
  });
});

describe('backoff', () => {
  it('grows exponentially and is capped', () => {
    const noJitter = () => 1;
    expect(backoffDelayMs(1, noJitter)).toBe(500);
    expect(backoffDelayMs(2, noJitter)).toBe(1_000);
    expect(backoffDelayMs(3, noJitter)).toBe(2_000);
    expect(backoffDelayMs(20, noJitter)).toBe(30_000);
  });

  /** Full jitter. Every retry in a run is the same caller, so a fixed schedule aligns them all. */
  it('applies jitter between half the base and the base', () => {
    expect(backoffDelayMs(3, () => 0)).toBe(1_000);
    expect(backoffDelayMs(3, () => 1)).toBe(2_000);
  });

  /** A 4xx other than 429 is our mistake. Repeating it spends budget and cannot succeed. */
  it('retries 429 and 5xx only', () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(401)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
  });
});
