import axios from 'axios';
import { listingsEnvelopeSchema } from '@cribstop/property-contracts';

import { closePool, getPool } from '../src/db/pool';
import { resolveBrightConfig } from '../src/jobs/bright-ingest/config';
import type { FetchLike } from '../src/jobs/bright-ingest/bright-client';
import { startRun } from '../src/jobs/bright-sync/store';
import {
  executeRun,
  resolveWorkerSettings,
  type WorkerContext,
} from '../src/jobs/bright-sync/worker';
import { complianceFixtureIds } from './support/fixture-ids';

/**
 * #715: the probe sweep against a REAL database and the real HTTP search, with Bright stubbed.
 * Seeds Bright-sourced live rows by cloning the plain sample fixture, so each clone is a full,
 * searchable listing. The test feed tier marks them `is_sample`, which is the tier the sweep reads.
 */
const fixtures = complianceFixtureIds();

const KEEP_KEYS = ['971500001', '971500002', '971500003'];
const STALE_KEY = '971500004';
const TERMINAL_KEY = '971500005';
const ALL_KEYS = [...KEEP_KEYS, STALE_KEY, TERMINAL_KEY];
const PROPERTY_KEY_PREFIX = 'probe-sweep-e2e:';

/** Bright's stub: the stale key is absent, the terminal key comes back Closed. */
const BRIGHT_FEED: Record<string, string> = {
  ...Object.fromEntries(KEEP_KEYS.map((key) => [key, 'Active'])),
  [TERMINAL_KEY]: 'Closed',
};

const ids: Record<string, string> = {};

const brightFetch: FetchLike = (url) => {
  const ok = (body: unknown) =>
    Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => null },
      text: () => Promise.resolve(JSON.stringify(body)),
    });
  if (url.includes('/token')) return ok({ access_token: 'stub', expires_in: 3600 });
  const filter = new URL(url).searchParams.get('$filter') ?? '';
  const asked = [...filter.matchAll(/\d+/g)].map((m) => m[0]);
  const value = asked
    .filter((key) => key in BRIGHT_FEED)
    .map((key) => ({ ListingKey: Number(key), StandardStatus: BRIGHT_FEED[key] }));
  return ok({ value, '@odata.count': value.length });
};

function context(): WorkerContext {
  const config = resolveBrightConfig({
    BRIGHT_MLS_ENV: 'test',
    BRIGHT_MLS_CLIENT_ID: 'stub',
    BRIGHT_MLS_CLIENT_SECRET: 'stub',
  });
  if (config.state !== 'configured') throw new Error('The stub Bright config must resolve.');
  return {
    config,
    settings: resolveWorkerSettings({}),
    log: () => undefined,
    fetchImpl: brightFetch,
  };
}

async function searchTotals(): Promise<{ total: number; ids: string[] }> {
  const found: string[] = [];
  let total = 0;
  for (let page = 1; ; page += 1) {
    const response = await axios.get('/listings', {
      // Scoped to the fixture city so the walk stays small on a database that holds real listings.
      params: { city: 'Fixtureville', state: 'ZZ', page, pageSize: 100 },
    });
    const envelope = listingsEnvelopeSchema.parse(response.data);
    total = envelope.total;
    found.push(...envelope.results.map((row) => row.id));
    if (found.length >= total || envelope.results.length === 0) return { total, ids: found };
  }
}

/** Column names of a table, minus generated columns and the ones the caller overrides. */
async function copyableColumns(table: string, skip: string[]): Promise<string> {
  const { rows } = await getPool().query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = $1 AND table_schema = 'public' AND is_generated = 'NEVER'
        AND column_name <> ALL($2::text[])`,
    [table, skip],
  );
  return rows.map((row) => `"${String(row.column_name)}"`).join(', ');
}

/**
 * Clones the sample listing onto its own copy of the sample property. The one-card-per-home
 * collapse (#716) merges records that share a property, so a clone on the shared property would
 * vanish from search. A distinct `address_key` makes each clone its own home.
 */
async function cloneSampleListing(sourceKey: string): Promise<string> {
  const pool = getPool();
  const propertyColumns = await copyableColumns('properties', [
    'id',
    'address_key',
    'street_line',
    'address_raw',
  ]);
  const property = await pool.query(
    `INSERT INTO properties (id, address_key, street_line, address_raw, ${propertyColumns})
     SELECT gen_random_uuid(), $2, $3, $3, ${propertyColumns}
       FROM properties
      WHERE id = (SELECT property_id FROM listings WHERE id = $1)
     RETURNING id`,
    [fixtures.sampleListingId, `${PROPERTY_KEY_PREFIX}${sourceKey}`, `${sourceKey} Probe Sweep St`],
  );
  const listingColumns = await copyableColumns('listings', [
    'id',
    'source_system',
    'source_listing_key',
    'property_id',
  ]);
  const inserted = await pool.query(
    `INSERT INTO listings (id, source_system, source_listing_key, property_id, ${listingColumns})
     SELECT gen_random_uuid(), 'BrightMLS', $2, $3, ${listingColumns} FROM listings WHERE id = $1
     RETURNING id`,
    [fixtures.sampleListingId, sourceKey, property.rows[0].id],
  );
  return String(inserted.rows[0].id);
}

async function runProbe(): Promise<Record<string, unknown>> {
  const pool = getPool();
  const ctx = context();
  const run = await startRun(pool, 'probe', {}, ctx.config.feed, 'e2e');
  expect(await executeRun(ctx, run)).toBe(true);
  const { rows } = await pool.query('SELECT counts FROM bright_sync_runs WHERE id = $1', [run.id]);
  return rows[0].counts as Record<string, unknown>;
}

/** Removes only the rows this spec seeded, events first because they reference the listings. */
async function removeSeeded(): Promise<void> {
  const pool = getPool();
  const seeded = 'SELECT id FROM listings WHERE source_listing_key = ANY($1::text[])';
  await pool.query(`DELETE FROM listing_events WHERE listing_id IN (${seeded})`, [ALL_KEYS]);
  await pool.query('DELETE FROM listings WHERE source_listing_key = ANY($1::text[])', [ALL_KEYS]);
  await pool.query('DELETE FROM properties WHERE address_key LIKE $1', [`${PROPERTY_KEY_PREFIX}%`]);
}

beforeAll(async () => {
  await removeSeeded();
  for (const key of ALL_KEYS) ids[key] = await cloneSampleListing(key);
});

afterAll(async () => {
  await removeSeeded();
  await closePool();
});

describe('probe sweep (#715)', () => {
  let before: { total: number; ids: string[] };

  it('shows every seeded key in search before the run', async () => {
    before = await searchTotals();
    for (const key of ALL_KEYS) expect(before.ids).toContain(ids[key]);
  });

  it('takes down the omitted key and the Closed key, keeps the Active keys (AC 2, 4, 9, 10)', async () => {
    const counts = await runProbe();
    expect(counts).toMatchObject({ takenDown: 2, errors: 0, aborted: false });

    const after = await searchTotals();
    for (const key of KEEP_KEYS) expect(after.ids).toContain(ids[key]);
    expect(after.ids).not.toContain(ids[STALE_KEY]);
    expect(after.ids).not.toContain(ids[TERMINAL_KEY]);
    expect(after.total).toBe(before.total - 2);
  });

  it('keeps the row and its URL, and the detail page no longer shows it for sale (AC 3, 9)', async () => {
    const { rows } = await getPool().query(
      'SELECT status, consumer_status, deleted_at FROM listings WHERE id = $1',
      [ids[STALE_KEY]],
    );
    expect(rows[0]).toMatchObject({
      status: 'Off Market',
      consumer_status: null,
      deleted_at: null,
    });

    const detail = await axios.get(`/listings/${ids[STALE_KEY]}`, { validateStatus: () => true });
    const body = JSON.stringify(detail.data);
    expect(body).not.toMatch(/"(status|consumerStatus)":"(Active|Pending|Coming Soon)"/);
  });

  it('changes nothing on a second run (AC 8)', async () => {
    const first = await searchTotals();
    const counts = await runProbe();
    expect(counts).toMatchObject({ takenDown: 0, aborted: false });
    expect((await searchTotals()).total).toBe(first.total);
  });
});
