import { getSuggestions } from './suggest';
import type { ReadClient } from './repository';

type Call = { sql: string; values: unknown[] };

function fakePool(rowsBySource: { city?: unknown[]; neighborhood?: unknown[]; zip?: unknown[] }) {
  const calls: Call[] = [];
  const pool = {
    query: async (sql: string, values: unknown[] = []) => {
      calls.push({ sql, values });
      const rows = sql.includes('l.zip5 LIKE')
        ? rowsBySource.zip
        : sql.includes('l.neighborhood) LIKE')
          ? rowsBySource.neighborhood
          : rowsBySource.city;
      return { rows: rows ?? [] };
    },
  } as unknown as ReadClient;
  return { pool, calls };
}

const city = (name: string) => ({ name, city: name, state: 'md', zip: null });
const hood = (name: string, c = 'Rockville') => ({ name, city: c, state: 'md', zip: null });

describe('getSuggestions', () => {
  it('queries ZIPs only for a digit prefix', async () => {
    const { pool, calls } = fakePool({
      zip: [{ name: '20850', city: 'ROCKVILLE', state: 'md', zip: '20850' }],
    });
    const result = await getSuggestions(pool, { q: '208' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toContain('l.zip5 LIKE');
    expect(result.suggestions).toEqual([
      { kind: 'zip', name: '20850', city: 'Rockville', state: 'MD', zip: '20850' },
    ]);
  });

  it('queries cities and neighborhoods for a text prefix, never ZIPs', async () => {
    const { pool, calls } = fakePool({
      city: [city('ROCKVILLE')],
      neighborhood: [hood('ROCKVILLE TOWN CENTER')],
    });
    const result = await getSuggestions(pool, { q: 'rock' });
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => !call.sql.includes('l.zip5 LIKE'))).toBe(true);
    expect(result.suggestions.map((s) => [s.kind, s.name])).toEqual([
      ['city', 'Rockville'],
      ['neighborhood', 'Rockville Town Center'],
    ]);
  });

  it('escapes LIKE wildcards and lower-cases the prefix', async () => {
    const { pool, calls } = fakePool({});
    await getSuggestions(pool, { q: 'A_B%C' });
    expect(calls[0]?.values[0]).toBe('a\\_b\\%c%');
  });

  it('passes the limit and defaults it to 8', async () => {
    const { pool, calls } = fakePool({});
    await getSuggestions(pool, { q: 'ro' });
    await getSuggestions(pool, { q: 'ro', limit: 3 });
    expect(calls[0]?.values[1]).toBe(8);
    expect(calls[2]?.values[1]).toBe(3);
  });

  it('keeps at least half the slots for cities and never exceeds the limit', async () => {
    const cities = Array.from({ length: 8 }, (_, i) => city(`CITY${i}`));
    const hoods = Array.from({ length: 8 }, (_, i) => hood(`HOOD${i}`));
    const { pool } = fakePool({ city: cities, neighborhood: hoods });
    const { suggestions } = await getSuggestions(pool, { q: 'ci', limit: 8 });
    expect(suggestions).toHaveLength(8);
    expect(suggestions.filter((s) => s.kind === 'city')).toHaveLength(4);
  });

  it('gives unused neighborhood slots to cities', async () => {
    const cities = Array.from({ length: 8 }, (_, i) => city(`CITY${i}`));
    const { pool } = fakePool({ city: cities });
    const { suggestions } = await getSuggestions(pool, { q: 'ci', limit: 8 });
    expect(suggestions).toHaveLength(8);
  });
});
