import axios from 'axios';
import { suggestResponseSchema } from '@cribstop/property-contracts';
import { closePool, getPool } from '../src/db/pool';
import { CITY_SQL, likePrefix, NEIGHBORHOOD_SQL, ZIP_SQL } from '../src/listings/suggest';
import {
  type HomeInput,
  removeCollapseFixtures,
  seedHomes,
  takeDown,
} from './support/collapse-fixtures';

/**
 * #781. Where suggestions against a REAL service and a REAL database. Cities and ZIPs here are
 * unique to this file. The fixture neighborhood is "Collapse Heights".
 */

const HOMES: HomeInput[] = [
  { street: '1 Zeb Rd', city: 'Zebrafield', zip: '98761', records: [{}] },
  { street: '2 Zeb Rd', city: 'Zebrafield', zip: '98761', records: [{}] },
  { street: '3 Zeb Rd', city: 'Zebraton', zip: '98762', records: [{}] },
  // Taken off-market below. Its city must not be suggested.
  { street: '4 Zeb Rd', city: 'Zebragone', zip: '98769', records: [{}] },
];

const pool = getPool();

async function suggest(params: Record<string, unknown>) {
  const response = await axios.get('/listings/suggest', { params });
  return suggestResponseSchema.parse(response.data).suggestions;
}

beforeAll(async () => {
  const seeded = await seedHomes(pool, HOMES);
  await takeDown(pool, seeded['4 Zeb Rd']?.ids[0] as string);
});

afterAll(async () => {
  await removeCollapseFixtures(pool);
  await closePool();
});

describe('GET /listings/suggest (#781)', () => {
  it('suggests cities by prefix, most listings first, with no off-market city', async () => {
    const result = await suggest({ q: 'zebra' });
    expect(
      result.filter((s) => s.kind === 'city').map(({ name, state }) => ({ name, state })),
    ).toEqual([
      { name: 'Zebrafield', state: 'ZZ' },
      { name: 'Zebraton', state: 'ZZ' },
    ]);
  });

  it('matches case-insensitively', async () => {
    const result = await suggest({ q: 'ZEBRAF' });
    expect(result.map((s) => s.name)).toEqual(['Zebrafield']);
  });

  it('suggests ZIPs for a digit prefix only', async () => {
    const result = await suggest({ q: '9876' });
    expect(result).toEqual([
      { kind: 'zip', name: '98761', city: 'Zebrafield', state: 'ZZ', zip: '98761' },
      { kind: 'zip', name: '98762', city: 'Zebraton', state: 'ZZ', zip: '98762' },
    ]);
  });

  it('suggests a neighborhood with its city', async () => {
    const result = await suggest({ q: 'collapse he' });
    expect(result).toContainEqual(
      expect.objectContaining({ kind: 'neighborhood', name: 'Collapse Heights', state: 'ZZ' }),
    );
  });

  it('treats a typed wildcard as text', async () => {
    expect(await suggest({ q: 'z%' })).toEqual([]);
  });

  it('caps the result at the limit', async () => {
    expect(await suggest({ q: 'zebra', limit: 1 })).toHaveLength(1);
  });

  it.each([
    ['one character', { q: 'z' }],
    ['no q', {}],
    ['limit over 10', { q: 'zebra', limit: 11 }],
    ['an unknown parameter', { q: 'zebra', x: 1 }],
  ])('rejects %s with 400', async (_label, params) => {
    const response = await axios.get('/listings/suggest', {
      params,
      validateStatus: () => true,
    });
    expect(response.status).toBe(400);
  });

  it('is not captured by /listings/:id', async () => {
    const response = await axios.get('/listings/suggest', { params: { q: 'zebra' } });
    expect(response.status).toBe(200);
  });
});

describe('suggest queries use the partial prefix indexes (#781)', () => {
  /*
   * A seeded table is tiny, so planner costs tie and the choice is noise. Inside a transaction
   * that always rolls back, drop every other non-unique index on `listings`, including the other suggest indexes, and turn off
   * sequential scans. The plan then names the suggest index only if its partial predicate is
   * implied by the query.
   */
  async function plan(sql: string, prefix: string, keep: string): Promise<string> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: others } = await client.query<{ name: string }>(
        `SELECT i.indexrelid::regclass::text AS name FROM pg_index i
          WHERE i.indrelid = 'listings'::regclass AND NOT i.indisprimary AND NOT i.indisunique
            AND i.indexrelid::regclass::text <> $1`,
        [keep],
      );
      for (const { name } of others) await client.query(`DROP INDEX ${name}`);
      await client.query('SET LOCAL enable_seqscan = off');
      const { rows } = await client.query(`EXPLAIN (ANALYZE, COSTS OFF) ${sql}`, [
        likePrefix(prefix),
        8,
      ]);
      await client.query('ROLLBACK');
      return rows.map((r: Record<string, string>) => r['QUERY PLAN']).join('\n');
    } finally {
      client.release();
    }
  }

  it.each([
    ['city', CITY_SQL, 'zebra', 'idx_listings_suggest_city'],
    ['zip', ZIP_SQL, '9876', 'idx_listings_suggest_zip'],
    ['neighborhood', NEIGHBORHOOD_SQL, 'collapse', 'idx_listings_suggest_neighborhood'],
  ])('%s reads its index only', async (_kind, sql, prefix, index) => {
    const text = await plan(sql, prefix, index);
    expect(text).toContain(`Index Only Scan using ${index}`);
  });
});
