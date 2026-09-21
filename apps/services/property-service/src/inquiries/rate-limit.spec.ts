import { createRateLimiter } from './rate-limit';

const CONFIG = {
  perIpMax: 2,
  perIpWindowMs: 60_000,
  perListingMax: 3,
  perListingWindowMs: 60_000,
};

describe('createRateLimiter', () => {
  it('allows requests up to the per-IP limit', () => {
    const limiter = createRateLimiter(CONFIG);

    expect(limiter.consume('1.1.1.1', 'listing-a').allowed).toBe(true);
    expect(limiter.consume('1.1.1.1', 'listing-b').allowed).toBe(true);
  });

  it('rejects the request over the per-IP limit, with a positive retry-after', () => {
    const limiter = createRateLimiter(CONFIG);
    limiter.consume('1.1.1.1', 'listing-a');
    limiter.consume('1.1.1.1', 'listing-b');

    const decision = limiter.consume('1.1.1.1', 'listing-c');

    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('tracks a different IP independently', () => {
    const limiter = createRateLimiter(CONFIG);
    limiter.consume('1.1.1.1', 'listing-a');
    limiter.consume('1.1.1.1', 'listing-b');

    expect(limiter.consume('2.2.2.2', 'listing-a').allowed).toBe(true);
  });

  it('rejects the request over the per-listing limit even from different IPs', () => {
    const limiter = createRateLimiter({ ...CONFIG, perIpMax: 100 });
    limiter.consume('1.1.1.1', 'listing-a');
    limiter.consume('2.2.2.2', 'listing-a');
    limiter.consume('3.3.3.3', 'listing-a');

    const decision = limiter.consume('4.4.4.4', 'listing-a');

    expect(decision.allowed).toBe(false);
  });

  it('resets the window once it elapses', () => {
    const limiter = createRateLimiter({ ...CONFIG, perIpWindowMs: 10 });
    limiter.consume('1.1.1.1', 'listing-a');
    limiter.consume('1.1.1.1', 'listing-b');
    expect(limiter.consume('1.1.1.1', 'listing-c').allowed).toBe(false);

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(limiter.consume('1.1.1.1', 'listing-d').allowed).toBe(true);
        resolve();
      }, 20);
    });
  });

  it('caps tracked keys so an attacker minting unique ids cannot grow the map without bound', () => {
    const limiter = createRateLimiter(CONFIG);

    // Far more than the internal cap (5000); this must not throw or grow unbounded.
    for (let i = 0; i < 5100; i += 1) {
      limiter.consume(`ip-${i}`, `listing-${i}`);
    }

    // The most recently inserted key must still be tracked (eviction drops the oldest, not the
    // newest): two more uses stay allowed, a third trips the per-IP limit of 2.
    expect(limiter.consume('ip-5099', 'listing-fresh-a').allowed).toBe(true);
    expect(limiter.consume('ip-5099', 'listing-fresh-b').allowed).toBe(false);
  });
});
