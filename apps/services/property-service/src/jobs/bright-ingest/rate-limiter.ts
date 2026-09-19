/**
 * Client-side request pacing for the Bright ingestion job (#92).
 *
 * ## Client-side is the only side
 *
 * Verified on 2026-09-18: **no Bright response carries a rate-limit header.** There is no
 * `X-Rate-Limit-*`, no `RateLimit-Limit`, and no `Retry-After`, on a success or on an error. So
 * nothing in a response tells this job how much budget is left, and nothing tells it how long to
 * wait after a refusal. The only control we have is the one we impose on ourselves.
 *
 * The contractual limits are not known and are not discoverable from the API. #33 records them when
 * the agreement is read. Until then the ceilings are configuration with conservative defaults, and
 * the defaults are deliberately slower than anything a licence is likely to allow: exceeding the
 * real ceiling risks a ban on the credentials, which is an outage on the primary surface, while
 * running under it costs a longer backfill that resumes on the next scheduled run anyway.
 *
 * ## A sliding window, not a token bucket
 *
 * A token bucket refills and therefore permits a burst of up to its capacity after any idle period.
 * That is the wrong shape when the ceiling is unknown: the first request of a nightly run would
 * arrive as a burst, which is exactly the pattern an unknown limiter is most likely to refuse. A
 * sliding window log never lets more than N requests exist inside any N-window, including the first
 * window of a full resync.
 *
 * Both windows apply at once and the stricter one wins. The concurrency limit is separate: a
 * per-second ceiling still allows every request of that second to be in flight together, which a
 * downstream with a connection cap reads as an attack.
 */

export interface RateLimitConfig {
  /** Maximum requests started inside any one-second window. */
  readonly requestsPerSecond: number;
  /** Maximum requests started inside any one-minute window. */
  readonly requestsPerMinute: number;
  /** Maximum requests in flight at once. */
  readonly maxConcurrency: number;
}

/**
 * Deliberately slow. These are placeholders, not measurements, and they are labelled as such in the
 * CronJob manifests so nobody reads them as the licence's numbers. #33 replaces them.
 */
export const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  requestsPerSecond: 2,
  requestsPerMinute: 60,
  maxConcurrency: 1,
};

export interface RateLimiterOptions {
  /** Monotonic milliseconds. Injected so a test paces a thousand requests without waiting. */
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

const SECOND_MS = 1_000;
const MINUTE_MS = 60_000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Paces every request the job makes.
 *
 * One limiter instance serves the whole run, across every resource. That is the point of the ticket
 * criterion that a second resource is configuration and not a fork: two independent callers with two
 * limiters would each stay under the ceiling and together exceed it.
 */
export class RateLimiter {
  private readonly config: RateLimitConfig;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  /** Start times of recent requests, oldest first. Trimmed to the one-minute window. */
  private readonly starts: number[] = [];
  private inFlight = 0;
  /** Serialises admission, so two callers cannot both read the window and both decide to go. */
  private admission: Promise<void> = Promise.resolve();
  private waiters: (() => void)[] = [];

  constructor(config: RateLimitConfig = DEFAULT_RATE_LIMITS, options: RateLimiterOptions = {}) {
    for (const [name, value] of Object.entries(config)) {
      if (!Number.isInteger(value) || value < 1) {
        throw new Error(`Rate limit ${name} must be a positive integer, got ${String(value)}.`);
      }
    }
    this.config = config;
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? defaultSleep;
  }

  /** Requests started inside the window ending now. Exposed for the run report and the tests. */
  startsWithin(windowMs: number): number {
    const cutoff = this.now() - windowMs;
    return this.starts.filter((at) => at > cutoff).length;
  }

  /**
   * Runs `operation` no earlier than the ceilings allow.
   *
   * Admission is serialised through a promise chain rather than a lock, because the wait itself is
   * asynchronous: two callers that both computed a delay from the same window state would both sleep
   * that delay and then both fire, which is how a "limiter" doubles the rate it was given.
   */
  async schedule<T>(operation: () => Promise<T>): Promise<T> {
    const admitted = this.admission.then(() => this.admit());
    // Chain on the admission itself, not on the operation, so a slow request does not block the
    // next caller beyond the concurrency limit, which is the thing that governs that.
    this.admission = admitted.catch(() => undefined);
    await admitted;

    this.inFlight += 1;
    try {
      return await operation();
    } finally {
      this.inFlight -= 1;
      const next = this.waiters.shift();
      if (next !== undefined) {
        next();
      }
    }
  }

  private async admit(): Promise<void> {
    while (this.inFlight >= this.config.maxConcurrency) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }

    for (;;) {
      const delay = this.delayUntilAllowed();
      if (delay <= 0) {
        break;
      }
      await this.sleep(delay);
    }

    const at = this.now();
    this.starts.push(at);
    this.trim(at);
  }

  /** Milliseconds to wait before another request may start. Zero when one may start now. */
  private delayUntilAllowed(): number {
    const at = this.now();
    this.trim(at);

    const perSecond = this.windowDelay(at, SECOND_MS, this.config.requestsPerSecond);
    const perMinute = this.windowDelay(at, MINUTE_MS, this.config.requestsPerMinute);
    return Math.max(perSecond, perMinute);
  }

  private windowDelay(at: number, windowMs: number, limit: number): number {
    const cutoff = at - windowMs;
    const inWindow = this.starts.filter((start) => start > cutoff);
    if (inWindow.length < limit) {
      return 0;
    }
    // The oldest request inside the window is the one that has to age out.
    const oldest = inWindow[inWindow.length - limit] ?? at;
    return Math.max(1, oldest + windowMs - at);
  }

  private trim(at: number): void {
    const cutoff = at - MINUTE_MS;
    while (this.starts.length > 0 && (this.starts[0] ?? 0) <= cutoff) {
      this.starts.shift();
    }
  }
}

/**
 * Exponential backoff with full jitter, for a 429 or a 5xx.
 *
 * Jitter is not decoration here. Every retry in a run is the same single caller retrying the same
 * endpoint, so a fixed schedule makes every attempt land on the same offset from the failure that
 * caused it — which, for a limiter that resets on a boundary, is the worst possible offset.
 *
 * `Retry-After` is not consulted, because Bright does not send it. If it ever appears, honour it in
 * preference to this and say so on #33.
 */
export function backoffDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(30_000, 500 * 2 ** Math.max(0, attempt - 1));
  return Math.round(base * (0.5 + 0.5 * random()));
}

/** Statuses worth retrying. A 4xx other than 429 is our mistake and repeating it wastes budget. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}
