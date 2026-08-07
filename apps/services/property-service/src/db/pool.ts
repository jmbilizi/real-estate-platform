import { Pool, PoolConfig, types } from 'pg';

/**
 * node-postgres returns NUMERIC as a STRING, because numeric is arbitrary-precision and JavaScript
 * numbers are not. That default is wrong for this service and fails silently: the web client declares
 * `Listing.price: number`, so an unparsed price sorts lexicographically — '900000' > '1295000' — with
 * no type error anywhere, in the API, in tests, and in the UI.
 *
 * property_db holds no accounting-critical numerics. Every numeric column here is a display quantity
 * (list/close price bounded at numeric(14,2), and baths_display at numeric(4,1)), all far inside the
 * exact-integer range of a float64, so parsing to number is lossless for these values. If this database
 * ever gains a column where cents must round-trip exactly (a ledger, a payout), do NOT widen this
 * parser — read that column as text and use a decimal type at the call site.
 */
types.setTypeParser(types.builtins.NUMERIC, (value) => (value === null ? null : Number(value)));

/**
 * Lazily-created singleton `pg` connection pool for the `property_db`
 * database, configured entirely from the `DATABASE_URL` env var (standard
 * for both `pg.Pool` and `node-pg-migrate`) — never hardcode credentials
 * here. See `.env.example` for the expected connection string shape.
 */
let pool: Pool | null = null;

export function getPool(config: PoolConfig = {}): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        'DATABASE_URL is not set. Copy .env.example to .env and point it at your property_db instance.',
      );
    }
    pool = new Pool({ connectionString, ...config });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
