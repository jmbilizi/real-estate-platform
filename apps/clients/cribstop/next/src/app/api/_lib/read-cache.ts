/**
 * #755. A short in-memory cache for the public listing reads that every home page load repeats.
 *
 * The Next.js server is the one process every visitor shares. Without a cache, each page load sends
 * the same dozen reads to the gateway, and every visitor's reads count against one gateway rate
 * limit bucket (the gateway keys limits on the caller IP, and that IP is this pod). A visitor who
 * reloads the page, or ten visitors in the same minute, then start to see "Failed to load" rows.
 *
 * The lifetime of an entry is the upstream's own `Cache-Control`, never a value chosen here:
 *  - `s-maxage`, when present, is the lifetime for a shared cache. This is one.
 *  - Otherwise `max-age`.
 *  - `no-store`, `private`, or no header at all: nothing is stored.
 *
 * So a listing read lives at most 60 seconds, the ceiling the Property API sets for any read that
 * embeds a time-relative fact (an upcoming open house) or a listing's status. A suppressed or
 * off-market listing disappears from these rows within that time. An error is never stored.
 *
 * Concurrent identical requests share one upstream call (`load`), so a cold or expired entry costs
 * the gateway one request, not one per visitor.
 */

/** Entries held at once. The least recently read entry goes first. */
export const READ_CACHE_MAX_ENTRIES = 500;

/** A body larger than this is never stored. One search page is about 10 KB. */
export const READ_CACHE_MAX_BODY_CHARS = 512 * 1024;

export interface CachedRead {
  readonly body: unknown;
  /** Browser lifetime the upstream allowed, in seconds. */
  readonly browserMaxAgeSeconds: number;
}

interface Entry extends CachedRead {
  readonly expiresAt: number;
}

export interface Lifetime {
  /** How long a shared cache may keep the response, in seconds. 0 means do not store. */
  readonly sharedSeconds: number;
  /** How long a browser may keep it, in seconds. */
  readonly browserSeconds: number;
}

function directive(header: string, name: string): number | null {
  const match = new RegExp(`(?:^|[\\s,])${name}=(\\d+)(?:[\\s,]|$)`, 'i').exec(header);
  return match ? Number(match[1]) : null;
}

/** Reads the lifetime a shared cache may use from an upstream `Cache-Control` value. */
export function lifetimeFrom(cacheControl: string | null): Lifetime {
  if (!cacheControl) return { sharedSeconds: 0, browserSeconds: 0 };
  if (/(?:^|[\s,])(?:no-store|no-cache|private)(?:[\s,]|$)/i.test(cacheControl)) {
    return { sharedSeconds: 0, browserSeconds: 0 };
  }
  const maxAge = directive(cacheControl, 'max-age') ?? 0;
  const sMaxAge = directive(cacheControl, 's-maxage');
  return { sharedSeconds: sMaxAge ?? maxAge, browserSeconds: maxAge };
}

export function createReadCache(
  now: () => number = Date.now,
  maxEntries: number = READ_CACHE_MAX_ENTRIES,
) {
  const store = new Map<string, Entry>();
  const inFlight = new Map<string, Promise<unknown>>();

  function fresh(key: string): Entry | null {
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now()) {
      store.delete(key);
      return null;
    }
    // Least recently used goes first: an entry that visitors keep reading outlives one that was
    // read once, so a burst of one-off queries cannot push the home rows out.
    store.delete(key);
    store.set(key, entry);
    return entry;
  }

  return {
    /** A live entry, with the seconds it has left. */
    get(key: string): { read: CachedRead; remainingSeconds: number } | null {
      const entry = fresh(key);
      if (!entry) return null;
      return {
        read: entry,
        remainingSeconds: Math.max(0, Math.floor((entry.expiresAt - now()) / 1000)),
      };
    },

    set(key: string, read: CachedRead, sharedSeconds: number): void {
      if (sharedSeconds <= 0) return;
      store.delete(key);
      store.set(key, { ...read, expiresAt: now() + sharedSeconds * 1000 });
      while (store.size > maxEntries) {
        const oldest = store.keys().next().value;
        if (oldest === undefined) break;
        store.delete(oldest);
      }
    },

    /** Runs `load` once for all callers that ask for `key` while it runs. */
    load<T>(key: string, load: () => Promise<T>): Promise<T> {
      const running = inFlight.get(key);
      if (running) return running as Promise<T>;
      const started = load().finally(() => {
        inFlight.delete(key);
      });
      inFlight.set(key, started);
      return started;
    },

    clear(): void {
      store.clear();
      inFlight.clear();
    },

    get size(): number {
      return store.size;
    },
  };
}

export type ReadCache = ReturnType<typeof createReadCache>;
