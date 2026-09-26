import { searchRequestSchema } from '@cribstop/property-contracts';

import type { AreaSyncClient } from './area-coverage-store';
import {
  areaKey,
  areaOf,
  createAreaLoader,
  parseAreaKey,
  placeSearchRequest,
  resolvedSearchRequest,
} from './on-demand';
import { BRIGHT_ENV_VARS } from '../jobs/bright-ingest/config';
import type { FetchLike } from '../jobs/bright-ingest/bright-client';
import { createMemoryStore } from '../jobs/bright-ingest/mock-reso-server';

const request = (input: Record<string, string>) => searchRequestSchema.parse(input);

/**
 * A fully provisioned Bright environment, one searchable status (`Active`), scoped to `test` — the
 * same shape `config.spec.ts` uses. `createAreaLoader` reads it via `resolveBrightConfig`.
 */
function configuredEnv(): NodeJS.ProcessEnv {
  return {
    [BRIGHT_ENV_VARS.env]: 'test',
    [BRIGHT_ENV_VARS.tokenEndpoint]: 'https://bright-staging.example.test/oauth/token',
    [BRIGHT_ENV_VARS.serviceRoot]: 'https://api-staging.example.test/reso/odata',
    [BRIGHT_ENV_VARS.clientId]: 'fixture-client-id',
    [BRIGHT_ENV_VARS.clientSecret]: 'fixture-client-secret',
  };
}

const tokenFetch: FetchLike = () =>
  Promise.resolve({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => null },
    text: () =>
      Promise.resolve(JSON.stringify({ access_token: 'fixture-token', expires_in: 3600 })),
  });

/** Answers `listing_statuses` with one searchable status, and `bright_area_sync` from `table`. */
function fakeAreaSyncClient(table: Map<string, Record<string, unknown>>): AreaSyncClient {
  return {
    query: <T>(text: string, values: unknown[] = []) => {
      if (text.includes('FROM listing_statuses')) {
        return Promise.resolve({
          rows: [
            {
              code: 'Active',
              consumer_status: 'Active',
              is_terminal: false,
              reso_standard_status: 'Active',
              is_publicly_searchable: true,
            },
          ] as unknown as T[],
        });
      }
      if (text.includes('SELECT source_status')) {
        const [areaKey, feedTier] = values as [string, string];
        const prefix = `${areaKey}|${feedTier}|`;
        const rows = [...table.entries()]
          .filter(([key]) => key.startsWith(prefix))
          .map(([, row]) => row);
        return Promise.resolve({ rows: rows as unknown as T[] });
      }
      if (text.includes("VALUES ($1, $2, $3, 'partial', 0, $4)")) {
        const [areaKey, feedTier, sourceStatus, attemptedAt] = values as [
          string,
          string,
          string,
          Date,
        ];
        const key = `${areaKey}|${feedTier}|${sourceStatus}`;
        const existing = table.get(key);
        if (existing !== undefined) {
          existing.attempted_at = attemptedAt;
        } else {
          table.set(key, {
            source_status: sourceStatus,
            status: 'partial',
            source_count: null,
            loaded_count: 0,
            resume_key: null,
            synced_at: null,
            attempted_at: attemptedAt,
          });
        }
        return Promise.resolve({ rows: [] as unknown as T[] });
      }
      if (text.includes("VALUES ($1, $2, $3, 'failed', 0, $4)")) {
        const [areaKey, feedTier, sourceStatus, attemptedAt] = values as [
          string,
          string,
          string,
          Date,
        ];
        const key = `${areaKey}|${feedTier}|${sourceStatus}`;
        const existing = table.get(key) ?? {
          source_count: null,
          loaded_count: 0,
          resume_key: null,
          synced_at: null,
        };
        table.set(key, {
          ...existing,
          source_status: sourceStatus,
          status: 'failed',
          attempted_at: attemptedAt,
        });
        return Promise.resolve({ rows: [] as unknown as T[] });
      }
      if (text.includes('VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)')) {
        const [
          areaKey,
          feedTier,
          sourceStatus,
          status,
          sourceCount,
          loadedCount,
          resumeKey,
          syncedAt,
          attemptedAt,
        ] = values as [
          string,
          string,
          string,
          string,
          number | null,
          number,
          string | null,
          Date | null,
          Date,
        ];
        const key = `${areaKey}|${feedTier}|${sourceStatus}`;
        table.set(key, {
          source_status: sourceStatus,
          status,
          source_count: sourceCount,
          loaded_count: loadedCount,
          resume_key: resumeKey,
          synced_at: syncedAt,
          attempted_at: attemptedAt,
        });
        return Promise.resolve({ rows: [] as unknown as T[] });
      }
      throw new Error(`fakeAreaSyncClient: unhandled query: ${text}`);
    },
  };
}

describe('areaOf', () => {
  it('reads a ZIP from zip or from a five-digit query', () => {
    expect(areaOf(request({ zip: '20910' }))).toEqual({ zip: '20910' });
    expect(areaOf(request({ query: '20910' }))).toEqual({ zip: '20910' });
  });

  it('title-cases a city from city or from a place-shaped query', () => {
    expect(areaOf(request({ city: 'silver spring', state: 'md' }))).toEqual({
      city: 'Silver Spring',
      state: 'MD',
    });
    expect(areaOf(request({ query: 'WINSTON-SALEM' }))).toEqual({ city: 'Winston-Salem' });
  });

  it('parses "City, ST" out of a free-text query, upper-casing the state', () => {
    expect(areaOf(request({ query: 'Frederick, MD' }))).toEqual({
      city: 'Frederick',
      state: 'MD',
    });
  });

  it('parses "City ST" (no comma) out of a free-text query', () => {
    expect(areaOf(request({ query: 'Frederick MD' }))).toEqual({
      city: 'Frederick',
      state: 'MD',
    });
  });

  it('parses "City, ST 12345" out of a free-text query, keeping the ZIP alongside the city', () => {
    expect(areaOf(request({ query: 'Frederick, MD 21701' }))).toEqual({
      city: 'Frederick',
      state: 'MD',
      zip: '21701',
    });
  });

  it('never lets the city absorb the state token', () => {
    // Neither ends in exactly a two-letter word, so both stay a bare city with no state.
    expect(areaOf(request({ query: 'Ocean City' }))).toEqual({ city: 'Ocean City' });
    expect(areaOf(request({ query: 'New York' }))).toEqual({ city: 'New York' });
  });

  it('lets an explicit city/state win over query entirely', () => {
    expect(areaOf(request({ query: 'Frederick, MD', city: 'Rockville', state: 'VA' }))).toEqual({
      city: 'Rockville',
      state: 'VA',
    });
  });

  it('lets an explicit state win over the state a query carried', () => {
    expect(areaOf(request({ query: 'Frederick, MD', state: 'VA' }))).toEqual({
      city: 'Frederick',
      state: 'VA',
    });
  });

  it('returns null for a query that is not a place', () => {
    expect(areaOf(request({ query: '123 Main St #4' }))).toBeNull();
    expect(areaOf(request({}))).toBeNull();
  });
});

/**
 * `bright_area_sync` (#329) stores only the composite `areaKey()`. The scheduled refresh and
 * reconciliation jobs (#331) read that key back out and need the city/zip/state to build a Bright
 * request, so `parseAreaKey()` has to invert `areaKey()` exactly.
 */
describe('parseAreaKey', () => {
  it('round-trips a city/state area through areaKey()', () => {
    const area = { city: 'Silver Spring', state: 'MD' };
    expect(parseAreaKey(areaKey(area))).toEqual(area);
  });

  it('round-trips a ZIP-only area', () => {
    const area = { zip: '20910' };
    expect(parseAreaKey(areaKey(area))).toEqual(area);
  });

  it('round-trips a city/state/zip area', () => {
    const area = { city: 'Frederick', state: 'MD', zip: '21701' };
    expect(parseAreaKey(areaKey(area))).toEqual(area);
  });

  it('recovers title-case for a multi-word, hyphenated city', () => {
    const area = { city: 'Winston-Salem', state: 'NC' };
    expect(parseAreaKey(areaKey(area))).toEqual(area);
  });
});

describe('placeSearchRequest', () => {
  it('carries only the parsed area, so a free-text and a structured search share one key', () => {
    const byQuery = areaOf(request({ query: 'Frederick, MD' }));
    const byFields = areaOf(request({ city: 'Frederick', state: 'MD' }));

    expect(byQuery).toEqual(byFields);
    expect(placeSearchRequest(byQuery!)).toEqual({ city: 'Frederick', state: 'MD' });
  });

  it('carries only city/state/zip, dropping nothing and adding nothing else', () => {
    expect(placeSearchRequest({ zip: '21701' })).toEqual({ zip: '21701' });
    expect(placeSearchRequest({ city: 'Rockville' })).toEqual({ city: 'Rockville' });
  });
});

describe('resolvedSearchRequest', () => {
  it('swaps a "City, ST" query for the parsed city and state', () => {
    const result = resolvedSearchRequest(request({ query: 'Frederick, MD' }));
    expect(result.query).toBeUndefined();
    expect(result.city).toBe('Frederick');
    expect(result.state).toBe('MD');
  });

  it('swaps a "City, ST 12345" query for the parsed city, state, and zip', () => {
    const result = resolvedSearchRequest(request({ query: 'Frederick, MD 21701' }));
    expect(result.query).toBeUndefined();
    expect(result.city).toBe('Frederick');
    expect(result.state).toBe('MD');
    expect(result.zip).toBe('21701');
  });

  it('keeps every other filter on the request untouched', () => {
    const result = resolvedSearchRequest(
      request({ query: 'Frederick, MD', minPrice: '100000', page: '2' }),
    );
    expect(result.minPrice).toBe(100000);
    expect(result.page).toBe(2);
  });

  it('leaves a bare-city query as-is, so a partial-name substring match still works', () => {
    const result = resolvedSearchRequest(request({ query: 'Fred' }));
    expect(result.query).toBe('Fred');
    expect(result.city).toBeUndefined();
  });

  it('leaves a ZIP-only query as-is', () => {
    const result = resolvedSearchRequest(request({ query: '21701' }));
    expect(result.query).toBe('21701');
  });

  it('leaves a query alongside an explicit state as-is, so the two stay independent filters', () => {
    const result = resolvedSearchRequest(request({ query: 'Frederick, MD', state: 'VA' }));
    expect(result.query).toBe('Frederick, MD');
    expect(result.state).toBe('VA');
  });

  it('leaves a request with no query, or one areaOf cannot parse, as-is', () => {
    const structured = request({ city: 'Frederick', state: 'MD' });
    expect(resolvedSearchRequest(structured)).toBe(structured);

    const notAPlace = request({ query: '123 Main St #4' });
    expect(resolvedSearchRequest(notAPlace)).toBe(notAPlace);
  });
});

describe('createAreaLoader', () => {
  it('skips every load when Bright is not configured', async () => {
    const loader = createAreaLoader({ env: {}, log: () => undefined });

    await expect(loader.load(request({ query: 'Rockville' }))).resolves.toBe('skipped');
  });

  /**
   * `bright_area_sync.attempted_at` is the replacement for the in-memory cooldown map (#329): it
   * must be visible to a SEPARATE `createAreaLoader()` call, which starts with none of the first
   * instance's in-memory state. A shared `AreaSyncClient` fake stands in for the shared database
   * both instances would really point at.
   */
  describe('the cooldown is shared through bright_area_sync, not per-instance', () => {
    /** Counts data-page attempts only, so the token call does not dilute the assertion. */
    function failingFetch(): { fetchImpl: FetchLike; dataAttempts: () => number } {
      let dataAttempts = 0;
      const fetchImpl: FetchLike = (url, init) => {
        if (init.method === 'POST') {
          return tokenFetch(url, init);
        }
        dataAttempts += 1;
        return Promise.reject(new Error('mock Bright: simulated network failure'));
      };
      return { fetchImpl, dataAttempts: () => dataAttempts };
    }

    it("a second, freshly constructed loader sees the first one's failed attempt and does not retry Bright", async () => {
      const table = new Map<string, Record<string, unknown>>();
      const clock = Date.parse('2026-09-26T00:00:00Z');
      const now = () => clock;
      const { fetchImpl, dataAttempts } = failingFetch();

      const first = createAreaLoader({
        env: configuredEnv(),
        fetchImpl,
        areaSyncClient: fakeAreaSyncClient(table),
        stagingStore: createMemoryStore().store,
        now,
        log: () => undefined,
      });
      await first.load(request({ city: 'Frederick' }));
      expect(dataAttempts()).toBe(1);
      expect([...table.values()]).toEqual([expect.objectContaining({ status: 'failed' })]);

      // A SEPARATE createAreaLoader(): no in-memory cooldown map survives from `first`. The only
      // thing that can block a retry is the `attempted_at` this second instance reads from `table`.
      const second = createAreaLoader({
        env: configuredEnv(),
        fetchImpl,
        areaSyncClient: fakeAreaSyncClient(table),
        stagingStore: createMemoryStore().store,
        now,
        log: () => undefined,
      });
      await second.load(request({ city: 'Frederick' }));
      expect(dataAttempts()).toBe(1); // still 1: the cooldown skipped it, no new Bright call.
    });

    it('does not wait the full hour to retry a failed status — failedCooldownMs is far shorter', async () => {
      const table = new Map<string, Record<string, unknown>>();
      let clock = Date.parse('2026-09-26T00:00:00Z');
      const now = () => clock;
      const { fetchImpl, dataAttempts } = failingFetch();

      const first = createAreaLoader({
        env: configuredEnv(),
        fetchImpl,
        areaSyncClient: fakeAreaSyncClient(table),
        stagingStore: createMemoryStore().store,
        now,
        log: () => undefined,
      });
      await first.load(request({ city: 'Frederick' }));
      expect(dataAttempts()).toBe(1);

      // Past the 5-minute default failedCooldownMs, nowhere near the 1-hour default cooldownMs.
      clock += 6 * 60 * 1000;
      const second = createAreaLoader({
        env: configuredEnv(),
        fetchImpl,
        areaSyncClient: fakeAreaSyncClient(table),
        stagingStore: createMemoryStore().store,
        now,
        log: () => undefined,
      });
      await second.load(request({ city: 'Frederick' }));
      expect(dataAttempts()).toBe(2); // retried, not blocked for the full hour.
    });
  });
});
