import { randomUUID } from 'node:crypto';

import type { ParsedPropertyPath } from '@cribstop/property-contracts';
import type { PoolClient } from 'pg';

import { getPool } from '../db/pool';
import {
  createTokenProvider,
  type FetchLike,
  fetchPage,
  type TokenProvider,
} from '../jobs/bright-ingest/bright-client';
import { type BrightConfig, resolveBrightConfig } from '../jobs/bright-ingest/config';
import { RateLimiter } from '../jobs/bright-ingest/rate-limiter';
import {
  type BrightStagingStore,
  createStagingStore,
  type StagedRecord,
} from '../jobs/bright-ingest/staging-store';
import { loadListingStatuses, mapBrightPayloads } from '../jobs/bright-map/run';
import { BRIGHT_SYNC_SELECT } from '../jobs/bright-sync/select';
import { titleCase } from './on-demand';
import type { AddressFetcher } from './property-page';

/**
 * The address lookup's MLS read (#349). An address we do not hold is read from Bright once, across
 * all statuses, in one bounded request (measured 0.3 s with a ZIP). What maps is stored through the
 * same mapper as the sync, so an Off market record lands with its status and no listing data shows.
 *
 * The 404 path is caller-driven, so each address is read at most once per cooldown. Search never
 * calls this.
 */

type ActiveConfig = Extract<BrightConfig, { state: 'configured' }>;

const MAX_RECORDS = 50;
const MAX_TRACKED_KEYS = 2000;

const odataString = (value: string): string => value.replace(/'/g, "''");

/**
 * `startswith` takes the house number and the first street word only, so `Place` and `Pl` both
 * match. The caller compares the normalized street after mapping. Bright rejects `or`, so the
 * place is one clause: the ZIP when the path has one, else city and state.
 */
export function buildAddressLookupUrl(serviceRoot: string, parsed: ParsedPropertyPath): string {
  const firstWord = parsed.street.split(' ')[0] ?? '';
  const prefix = `${parsed.houseNumber.toUpperCase()} ${titleCase(firstWord)}`;
  const place =
    parsed.zip !== null
      ? `PostalCode eq '${parsed.zip}'`
      : `City eq '${odataString(titleCase(parsed.city))}' and StateOrProvince eq '${parsed.state}'`;
  const search = new URLSearchParams();
  search.set('$filter', `${place} and startswith(UnparsedAddress,'${odataString(prefix)}')`);
  search.set('$select', BRIGHT_SYNC_SELECT.join(','));
  search.set('$top', String(MAX_RECORDS));
  return `${serviceRoot.replace(/\/+$/, '')}/BrightProperties?${search.toString()}`;
}

function toStaged(record: Record<string, unknown>): StagedRecord | null {
  const key = record.ListingKey;
  const modified = record.ModificationTimestamp;
  const at = typeof modified === 'string' ? new Date(modified) : null;
  if ((typeof key !== 'string' && typeof key !== 'number') || at === null) return null;
  if (Number.isNaN(at.getTime())) return null;
  return { recordKey: String(key), modifiedAt: at.toISOString(), payload: record };
}

function soldDelayFrom(env: NodeJS.ProcessEnv): number | null {
  const raw = env.BRIGHT_SOLD_DISPLAY_DELAY_DAYS;
  if (raw === undefined || raw.trim() === '') return null;
  const days = Number(raw);
  return Number.isFinite(days) && days >= 0 ? days : null;
}

export interface AddressLoaderOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly cooldownMs?: number;
  readonly now?: () => number;
  readonly fetchImpl?: FetchLike;
  readonly log?: (message: string) => void;
  readonly stagingStore?: BrightStagingStore;
  readonly connect?: () => Promise<PoolClient>;
}

export function createAddressLoader(options: AddressLoaderOptions = {}): AddressFetcher {
  const env = options.env ?? process.env;
  const cooldownMs =
    options.cooldownMs ?? Number(env.BRIGHT_ADDRESS_LOOKUP_COOLDOWN_MS ?? 3_600_000);
  const now = options.now ?? (() => Date.now());
  const log = options.log ?? ((message: string) => console.warn(message));
  const connect = options.connect ?? (() => getPool().connect());
  const soldDisplayDelayDays = soldDelayFrom(env);

  let config: ActiveConfig | null = null;
  try {
    const resolved = resolveBrightConfig(env);
    config = resolved.state === 'configured' ? resolved : null;
  } catch {
    config = null;
  }
  const limiter =
    config === null
      ? null
      : new RateLimiter({
          requestsPerSecond: config.replication.requestsPerSecond,
          requestsPerMinute: config.replication.requestsPerMinute,
          maxConcurrency: config.replication.maxConcurrency,
        });
  let tokenProvider: TokenProvider | null = null;
  const attemptedAt = new Map<string, number>();

  function coolingDown(key: string): boolean {
    const at = attemptedAt.get(key);
    if (at !== undefined && now() - at < cooldownMs) return true;
    if (attemptedAt.size >= MAX_TRACKED_KEYS) {
      const oldest = attemptedAt.keys().next().value;
      if (oldest !== undefined) attemptedAt.delete(oldest);
    }
    attemptedAt.delete(key);
    attemptedAt.set(key, now());
    return false;
  }

  return {
    async fetchAddress(parsed) {
      if (config === null) return;
      const active = config;
      const key = `${parsed.streetLine}|${parsed.unitNumber ?? ''}|${parsed.city}|${parsed.state}|${parsed.zip ?? ''}`;
      if (coolingDown(key)) return;
      tokenProvider ??= createTokenProvider(active.endpoint, active.credentials, {
        fetchImpl: options.fetchImpl,
        timeoutMs: active.replication.requestTimeoutMs,
      });
      try {
        const page = await fetchPage(
          buildAddressLookupUrl(active.endpoint.serviceRoot, parsed),
          tokenProvider,
          active.endpoint.serviceRootHost,
          {
            ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
            ...(limiter === null ? {} : { limiter }),
            maxRetries: 1,
            timeoutMs: active.replication.requestTimeoutMs,
          },
        );
        const records = page.records as Record<string, unknown>[];
        if (records.length === 0) return;
        const staged = records
          .map(toStaged)
          .filter((record): record is StagedRecord => record !== null);
        await (options.stagingStore ?? createStagingStore()).stageRecords({
          resource: 'BrightProperties',
          feedTier: active.feed,
          runId: randomUUID(),
          records: staged,
        });
        const client = await connect();
        try {
          await client.query('BEGIN');
          const statuses = await loadListingStatuses(client);
          const { report } = await mapBrightPayloads(client, records, {
            feed: active.feed,
            soldDisplayDelayDays,
            statuses,
          });
          await client.query('COMMIT');
          log(`Bright address lookup: ${records.length} read, ${report.mapped} mapped.`);
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      } catch (error) {
        // A failed read is a 404 for this request, never a 500: the page has nothing to show.
        log(
          `Bright address lookup failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  };
}
