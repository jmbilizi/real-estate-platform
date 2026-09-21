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

function checkAndConsume(
  map: Map<string, Counter>,
  key: string,
  max: number,
  windowMs: number,
  now: number,
): RateLimitDecision {
  const existing = map.get(key);
  if (!existing || now - existing.windowStart >= windowMs) {
    evictOldestIfFull(map);
    map.set(key, { count: 1, windowStart: now });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (existing.count >= max) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((existing.windowStart + windowMs - now) / 1000),
    );
    return { allowed: false, retryAfterSeconds };
  }
  existing.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

export function createRateLimiter(config: RateLimitConfig): RateLimiter {
  const byIp = new Map<string, Counter>();
  const byListing = new Map<string, Counter>();

  return {
    consume(clientIp: string, listingId: string): RateLimitDecision {
      const now = Date.now();

      const ipDecision = checkAndConsume(
        byIp,
        clientIp,
        config.perIpMax,
        config.perIpWindowMs,
        now,
      );
      if (!ipDecision.allowed) {
        return ipDecision;
      }

      return checkAndConsume(
        byListing,
        listingId,
        config.perListingMax,
        config.perListingWindowMs,
        now,
      );
    },
  };
}
