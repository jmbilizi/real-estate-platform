/**
 * Fixed-window in-memory rate limiting for `POST /listings/:id/inquiries` (#131), keyed
 * independently per client IP and per listing.
 *
 * Per process, like the gateway's own Ocelot limiter and account-service's
 * `AccountRecoveryRateLimiter`: with more than one replica the effective limit multiplies by the
 * replica count. That is a weaker bound, not an absent one. Redis is the scale-out path if replica
 * counts rise; this ticket does not introduce this platform's first Node Redis client for one
 * endpoint when the existing in-process pattern is the one every other Node/​.NET service already
 * uses at this traffic scale.
 */

export interface RateLimitConfig {
  perIpMax: number;
  perIpWindowMs: number;
  perListingMax: number;
  perListingWindowMs: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds until the caller may retry. Only meaningful when `allowed` is false. */
  retryAfterSeconds: number;
}

export interface RateLimiter {
  consume(clientIp: string, listingId: string): RateLimitDecision;
}

interface Counter {
  count: number;
  windowStart: number;
}

/**
 * Caps each map's size so an attacker minting unique IPs or listing ids cannot grow this
 * unboundedly. Eviction drops the oldest 10% (insertion order, which `Map` preserves) rather than
 * clearing everything, so a full map degrades gradually instead of opening a burst window for
 * every existing key at once.
 */
const MAX_TRACKED_KEYS = 5000;
const EVICTION_SHARE = 0.1;

function evictOldestIfFull(map: Map<string, Counter>): void {
  if (map.size < MAX_TRACKED_KEYS) {
    return;
  }
  const evictCount = Math.max(1, Math.floor(map.size * EVICTION_SHARE));
  const keys = map.keys();
  for (let i = 0; i < evictCount; i += 1) {
    const next = keys.next();
    if (next.done) {
      break;
    }
    map.delete(next.value);
  }
}

interface PeekResult {
  withinLimit: boolean;
  retryAfterSeconds: number;
}

/** Read-only: whether `key` is currently within `max` for the window, without mutating anything.
 *  Separated from `commit` so a caller can check EVERY limit before consuming ANY of them — see
 *  `consume()` below for why that ordering matters. */
function peek(
  map: Map<string, Counter>,
  key: string,
  max: number,
  windowMs: number,
  now: number,
): PeekResult {
  const existing = map.get(key);
  if (!existing || now - existing.windowStart >= windowMs) {
    return { withinLimit: true, retryAfterSeconds: 0 };
  }
  if (existing.count >= max) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((existing.windowStart + windowMs - now) / 1000),
    );
    return { withinLimit: false, retryAfterSeconds };
  }
  return { withinLimit: true, retryAfterSeconds: 0 };
}

/** Records one use of `key`, starting a fresh window if the previous one lapsed. Eviction runs
 *  only when the key is genuinely new to the map — an expired window on an EXISTING key is an
 *  overwrite, not growth, and must not evict an unrelated client's counter for no capacity
 *  reason. */
function commit(map: Map<string, Counter>, key: string, windowMs: number, now: number): void {
  const existing = map.get(key);
  if (existing && now - existing.windowStart < windowMs) {
    existing.count += 1;
    return;
  }
  if (!map.has(key)) {
    evictOldestIfFull(map);
  }
  map.set(key, { count: 1, windowStart: now });
}

/**
 * Fixed-window, in-memory, per process (#131). Same trade-off `AccountRecoveryRateLimiter`
 * documents: with more than one replica the effective limit multiplies by the replica count.
 * That is a weaker bound, not an absent one — Redis is the scale-out path if replica counts rise.
 */
export function createRateLimiter(config: RateLimitConfig): RateLimiter {
  const byIp = new Map<string, Counter>();
  const byListing = new Map<string, Counter>();

  return {
    consume(clientIp: string, listingId: string): RateLimitDecision {
      const now = Date.now();

      /**
       * Both limits are PEEKED before either is COMMITTED. Checking and consuming the IP limit
       * first, then discovering the listing limit is exhausted, used to debit the caller's own
       * IP budget for a request that was always going to be rejected — a client could be locked
       * out of every OTHER listing for up to an hour purely because a different listing's shared
       * bucket happened to be full. Peeking both first means a rejection on either axis costs the
       * caller nothing on the other.
       */
      const ipCheck = peek(byIp, clientIp, config.perIpMax, config.perIpWindowMs, now);
      if (!ipCheck.withinLimit) {
        return { allowed: false, retryAfterSeconds: ipCheck.retryAfterSeconds };
      }

      const listingCheck = peek(
        byListing,
        listingId,
        config.perListingMax,
        config.perListingWindowMs,
        now,
      );
      if (!listingCheck.withinLimit) {
        return { allowed: false, retryAfterSeconds: listingCheck.retryAfterSeconds };
      }

      commit(byIp, clientIp, config.perIpWindowMs, now);
      commit(byListing, listingId, config.perListingWindowMs, now);
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}
