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

  it('never debits the per-IP budget for a request the per-listing limit rejects', () => {
    // Three DIFFERENT callers exhaust "popular-listing"'s shared bucket (max 3 here).
    const limiter = createRateLimiter(CONFIG);
    limiter.consume('a.a.a.a', 'popular-listing');
    limiter.consume('b.b.b.b', 'popular-listing');
    limiter.consume('c.c.c.c', 'popular-listing');

    // A fourth caller is rejected on the LISTING axis, not the IP axis.
    const rejected = limiter.consume('2.2.2.2', 'popular-listing');
    expect(rejected.allowed).toBe(false);

    // That caller's own per-IP budget (max 2) must still be full: if the rejected attempt above
    // had debited it, only ONE of these two would succeed.
    expect(limiter.consume('2.2.2.2', 'other-listing-1').allowed).toBe(true);
    expect(limiter.consume('2.2.2.2', 'other-listing-2').allowed).toBe(true);
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
