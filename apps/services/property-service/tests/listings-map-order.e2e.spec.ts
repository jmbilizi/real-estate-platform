import type { Pool, PoolClient } from 'pg';
import { mapRequestSchema } from '@cribstop/property-contracts';
import { closePool, getPool } from '../src/db/pool';
import { findMapPins } from '../src/listings/map-query';
import type { ReadPool } from '../src/listings/repository';

/**
 * #548. The map pins are the newest listings in the viewport, newest first, ties broken by id.
 * The set, the order and `total` must not depend on the plan Postgres picks. Rows sit far from the
 * compliance fixtures (latitude 60), carry `is_sample` and a `(Sample)` title, and are deleted at
 * the end.
 */
const MARKER = 'map-order-548';
const ROWS = 2500;
const WITHHELD_EVERY = 25;
const CAP = 1000;

const WIDE = '-1,59,1,61';
const NARROW = '0.3,60.3,0.35,60.35';

let pool: Pool;

async function seed(): Promise<void> {
  await pool.query(
    `INSERT INTO properties (address_key, address_raw, city, state, property_type, street_line, zip5, is_sample)
     SELECT $1 || g, g || ' Order St', 'Ordertown', 'MD', 'Single Family', g || ' Order St', '20999', true
     FROM generate_series(1, $2::int) g`,
    [MARKER, ROWS],
  );
  // Many equal `last_updated` values, so the id tie-break decides the order of most rows.
  await pool.query(
    `WITH p AS (
       SELECT id, row_number() OVER (ORDER BY id) rn FROM properties WHERE address_key LIKE $1 || '%')
     INSERT INTO listings (property_id, title, city, state, zip5, status, consumer_status, list_price,
       offer_kind, source, broker_name, broker_phone, office_name, last_updated, latitude, longitude,
       address_display_allowed, is_sample)
     SELECT id, 'Order home ' || rn || ' (Sample)', 'Ordertown', 'MD', '20999', 'Active', 'Active',
       300000 + rn, 'sale', 'internal', 'b', '555', $1,
       timestamptz '2026-01-01' + ((rn % 40) || ' minutes')::interval,
       60 + (rn % 50) / 100.0, (rn % 97) / 100.0 - 0.3, rn % $2::int <> 0, true
     FROM p`,
    [MARKER, WITHHELD_EVERY],
  );
}

async function expectedIds(): Promise<string[]> {
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM listings WHERE office_name = $1 AND address_display_allowed
     ORDER BY last_updated DESC, id DESC`,
    [MARKER],
  );
  return result.rows.map((row) => row.id);
}

/** A pool whose connections run `settings` first, to force a different plan. */
function planPool(settings: string[]): ReadPool {
  return {
    query: (text: string, values?: unknown[]) => pool.query(text, values),
    connect: async () => {
      const client: PoolClient = await pool.connect();
      for (const setting of settings) {
        await client.query(setting);
      }
      const release = client.release.bind(client);
      return Object.assign(client, {
        release: () => {
          void client.query('RESET ALL').finally(() => release());
        },
      });
    },
  } as unknown as ReadPool;
}

const PLANS: Array<[string, string[]]> = [
  ['the default plan', []],
  ['the newest index in order', ['SET enable_sort = off']],
  ['the coordinate index', ['SET enable_indexscan = off', 'SET enable_seqscan = off']],
];

describe('GET /listings/map order (#548)', () => {
  beforeAll(async () => {
    pool = getPool();
    await seed();
    await pool.query('ANALYZE listings');
  });

  afterAll(async () => {
    await pool.query('DELETE FROM listings WHERE office_name = $1', [MARKER]);
    await pool.query("DELETE FROM properties WHERE address_key LIKE $1 || '%'", [MARKER]);
    await closePool();
  });

  it.each(PLANS)('returns the newest pins in id order under %s', async (_name, settings) => {
    const expected = await expectedIds();
    const request = mapRequestSchema.parse({ bounds: WIDE });

    const response = await findMapPins(planPool(settings), request, CAP);

    expect(expected).toHaveLength(ROWS - ROWS / WITHHELD_EVERY);
    expect(response.total).toBe(expected.length);
    expect(response.pins.map((pin) => pin.id)).toEqual(expected.slice(0, CAP));
  });

  it.each(PLANS)('returns the whole narrow viewport in order under %s', async (_name, settings) => {
    const request = mapRequestSchema.parse({ bounds: NARROW });
    const reference = await pool.query<{ id: string }>(
      `SELECT id FROM listings WHERE office_name = $1 AND address_display_allowed
         AND latitude BETWEEN 60.3 AND 60.35 AND longitude BETWEEN 0.3 AND 0.35
       ORDER BY last_updated DESC, id DESC`,
      [MARKER],
    );

    const response = await findMapPins(planPool(settings), request, 100_000);

    expect(reference.rows.length).toBeGreaterThan(0);
    expect(response.total).toBe(reference.rows.length);
    expect(response.pins.map((pin) => pin.id)).toEqual(reference.rows.map((row) => row.id));
  });
});
