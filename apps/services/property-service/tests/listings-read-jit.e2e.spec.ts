import { neighborhoodsRequestSchema } from '@cribstop/property-contracts';
import { closePool, getPool } from '../src/db/pool';
import { getListingsMeta, getNeighborhoods, type ReadPool } from '../src/listings/repository';
import { assertFixturesEnabled } from './support/fixtures';

/**
 * #1003. The neighborhoods and meta reads must not compile with JIT. On dev the planner priced the
 * collapse probes above `jit_above_cost`, and the compile took 1.7 s of a 2 s read, so the 4 s
 * statement timeout fired. The guard does not need dev's row volume: it forces
 * `jit_above_cost = 0`, so any plan that does not switch JIT off compiles, and reads the JIT section
 * of `EXPLAIN (ANALYZE)`.
 */

interface PlanDocument {
  JIT?: unknown;
}

/** A pool whose statement runs as `EXPLAIN (ANALYZE, FORMAT JSON)` on one connection. */
function explainingPool(plans: PlanDocument[]): ReadPool {
  return {
    query: () => Promise.reject(new Error('The read must open its own transaction.')),
    connect: async () => {
      const client = await getPool().connect();
      return {
        query: async <T>(text: string, values?: unknown[]) => {
          if (/^(BEGIN|SET LOCAL|COMMIT|ROLLBACK)/.test(text)) {
            await client.query(text);
            if (text.startsWith('BEGIN')) await client.query('SET LOCAL jit_above_cost = 0');
            return { rows: [] as T[] };
          }
          const result = await client.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${text}`, values);
          const plan = result.rows[0]['QUERY PLAN'] as PlanDocument[];
          plans.push(plan[0] as PlanDocument);
          return { rows: [] as T[] };
        },
        release: () => client.release(),
      };
    },
  };
}

describe('listing reads compile without JIT (#1003)', () => {
  beforeAll(() => {
    assertFixturesEnabled();
  });

  afterAll(async () => {
    await closePool();
  });

  it('control: the forced settings make an unguarded statement compile with JIT', async () => {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN READ ONLY');
      await client.query('SET LOCAL jit_above_cost = 0');
      const result = await client.query(
        'EXPLAIN (ANALYZE, FORMAT JSON) SELECT count(*) FROM listings',
      );
      const plan = result.rows[0]['QUERY PLAN'] as PlanDocument[];
      expect(plan[0]?.JIT).toBeDefined();
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('getNeighborhoods, state-wide shape', async () => {
    const plans: PlanDocument[] = [];
    const request = neighborhoodsRequestSchema.parse({ state: 'MD', limit: '24', minCount: '5' });

    await getNeighborhoods(explainingPool(plans), request);

    expect(plans).toHaveLength(1);
    expect(plans[0]?.JIT).toBeUndefined();
  });

  it('getNeighborhoods, view path', async () => {
    const plans: PlanDocument[] = [];
    const request = neighborhoodsRequestSchema.parse({ state: 'MD', beds: '2' });

    await getNeighborhoods(explainingPool(plans), request);

    expect(plans[0]?.JIT).toBeUndefined();
  });

  it('getListingsMeta', async () => {
    const plans: PlanDocument[] = [];

    await expect(getListingsMeta(explainingPool(plans))).rejects.toThrow();

    expect(plans).toHaveLength(1);
    expect(plans[0]?.JIT).toBeUndefined();
  });
});
