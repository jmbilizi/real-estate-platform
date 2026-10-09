import { searchRequestSchema } from '@cribstop/property-contracts';
import { type ReadPool, searchListings } from './repository';

/**
 * #755. A home page row shows a handful of cards and never reads `total`. `skipTotal` drops the
 * exact count, which scans every matching listing. The page query stays.
 */
function fakePool(): { pool: ReadPool; statements: string[] } {
  const statements: string[] = [];
  const client = {
    query: (text: string) => {
      statements.push(text);
      if (/count\(\*\)/i.test(text)) return Promise.resolve({ rows: [{ total: 1234 }] });
      return Promise.resolve({ rows: [] });
    },
    release: () => undefined,
  };
  const pool: ReadPool = {
    query: client.query as ReadPool['query'],
    connect: () => Promise.resolve(client as unknown as Awaited<ReturnType<ReadPool['connect']>>),
  };
  return { pool, statements };
}

describe('searchListings skipTotal (#755)', () => {
  it('runs the exact count by default', async () => {
    const { pool, statements } = fakePool();

    const envelope = await searchListings(pool, searchRequestSchema.parse({ pageSize: '8' }));

    expect(statements.filter((text) => /count\(\*\)/i.test(text))).toHaveLength(1);
    expect(envelope.total).toBe(1234);
    expect(envelope.pageCount).toBe(155);
  });

  it('runs no count when skipTotal is true', async () => {
    const { pool, statements } = fakePool();

    await searchListings(pool, searchRequestSchema.parse({ pageSize: '8', skipTotal: 'true' }));

    expect(statements.filter((text) => /count\(\*\)/i.test(text))).toHaveLength(0);
    expect(statements.some((text) => /ORDER BY/i.test(text))).toBe(true);
  });

  it('reports the page size as total, and no page past the first', async () => {
    const { pool } = fakePool();

    const envelope = await searchListings(
      pool,
      searchRequestSchema.parse({ pageSize: '8', skipTotal: 'true' }),
    );

    expect(envelope.total).toBe(0);
    expect(envelope.pageCount).toBe(0);
  });

  it('still runs the count when skipTotal is false', async () => {
    const { pool, statements } = fakePool();

    await searchListings(pool, searchRequestSchema.parse({ skipTotal: 'false' }));

    expect(statements.filter((text) => /count\(\*\)/i.test(text))).toHaveLength(1);
  });
});
