import { Pool, PoolConfig } from 'pg';

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
