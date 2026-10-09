import { createReadCache, lifetimeFrom, READ_CACHE_MAX_ENTRIES } from './read-cache';

describe('lifetimeFrom (#755)', () => {
  it('uses max-age when there is no s-maxage', () => {
    expect(lifetimeFrom('public, max-age=60')).toEqual({ sharedSeconds: 60, browserSeconds: 60 });
  });

  it('uses s-maxage for the shared cache and max-age for the browser', () => {
    expect(lifetimeFrom('public, max-age=60, s-maxage=300, stale-while-revalidate=60')).toEqual({
      sharedSeconds: 300,
      browserSeconds: 60,
    });
  });

  it.each(['no-store', 'private, max-age=60', 'public, no-cache', '', null])(
    'stores nothing for %p',
    (header) => {
      expect(lifetimeFrom(header).sharedSeconds).toBe(0);
    },
  );

  it('stores nothing when the header names no lifetime', () => {
    expect(lifetimeFrom('public').sharedSeconds).toBe(0);
  });
});

describe('createReadCache (#755)', () => {
  it('serves an entry until its lifetime ends, then drops it', () => {
    let clock = 1_000;
    const cache = createReadCache(() => clock);
    cache.set('k', { body: { a: 1 }, browserMaxAgeSeconds: 60 }, 60);

    clock += 59_000;
    expect(cache.get('k')?.remainingSeconds).toBe(1);

    clock += 1_000;
    expect(cache.get('k')).toBeNull();
    expect(cache.size).toBe(0);
  });

  it('stores nothing for a lifetime of 0', () => {
    const cache = createReadCache();
    cache.set('k', { body: {}, browserMaxAgeSeconds: 0 }, 0);

    expect(cache.get('k')).toBeNull();
  });

  it('drops the oldest entry past the limit', () => {
    const cache = createReadCache();
    for (let i = 0; i <= READ_CACHE_MAX_ENTRIES; i += 1) {
      cache.set(`k${i}`, { body: i, browserMaxAgeSeconds: 60 }, 60);
    }

    expect(cache.size).toBe(READ_CACHE_MAX_ENTRIES);
    expect(cache.get('k0')).toBeNull();
    expect(cache.get(`k${READ_CACHE_MAX_ENTRIES}`)).not.toBeNull();
  });

  it('keeps an entry that is read often when one-off entries fill the cache', () => {
    const cache = createReadCache();
    cache.set('home', { body: 'home', browserMaxAgeSeconds: 60 }, 60);
    for (let i = 0; i < READ_CACHE_MAX_ENTRIES * 2; i += 1) {
      cache.set(`one-off-${i}`, { body: i, browserMaxAgeSeconds: 60 }, 60);
      cache.get('home');
    }

    expect(cache.get('home')).not.toBeNull();
  });

  it('runs one load for callers that ask for the same key while it runs', async () => {
    const cache = createReadCache();
    let release: (value: string) => void = () => undefined;
    const load = jest.fn(() => new Promise<string>((resolve) => (release = resolve)));

    const first = cache.load('k', load);
    const second = cache.load('k', load);
    release('done');

    await expect(Promise.all([first, second])).resolves.toEqual(['done', 'done']);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('lets the next call retry after a failed load', async () => {
    const cache = createReadCache();

    await expect(cache.load('k', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(cache.load('k', () => Promise.resolve('ok'))).resolves.toBe('ok');
  });
});
