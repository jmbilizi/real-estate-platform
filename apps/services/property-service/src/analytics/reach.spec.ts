import type { ReadClient } from '../listings/repository';
import { REACH_REFRESH_DAYS, refreshAnalyticsReach } from './reach';

function createDb(result: boolean) {
  const calls: { sql: string; values: unknown[] }[] = [];
  const db: ReadClient = {
    query: <T>(sql: string, values: unknown[] = []): Promise<{ rows: T[] }> => {
      calls.push({ sql, values });
      return Promise.resolve({ rows: [{ refreshed: result }] as T[] });
    },
  };
  return { db, calls };
}

describe('refreshAnalyticsReach (#828)', () => {
  it('calls the SQL function for the recent days only', async () => {
    const { db, calls } = createDb(true);
    await expect(refreshAnalyticsReach(db)).resolves.toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toContain('refresh_analytics_daily_reach');
    expect(calls[0]?.values).toEqual([REACH_REFRESH_DAYS]);
  });

  it('reports false when another pod holds the lock', async () => {
    const { db } = createDb(false);
    await expect(refreshAnalyticsReach(db)).resolves.toBe(false);
  });
});
