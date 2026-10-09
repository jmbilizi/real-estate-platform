import request from 'supertest';
import { createApp } from '../app';
import type { ReadPool } from './repository';

/**
 * #747. Every read path builds its WHERE from `buildSearchQuery`. This proves each route sends the
 * drawn shape to the database, and refuses a bad one before any query runs.
 */
const SHAPE = JSON.stringify({
  type: 'Polygon',
  coordinates: [
    [
      [-77.05, 38.89],
      [-77.04, 38.89],
      [-77.04, 38.9],
      [-77.05, 38.9],
      [-77.05, 38.89],
    ],
  ],
});
const BOWTIE = JSON.stringify({
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [2, 2],
      [2, 0],
      [0, 2],
      [0, 0],
    ],
  ],
});

interface Recorded {
  text: string;
  values: unknown[];
}

function recordingPool(): ReadPool & { calls: Recorded[] } {
  const calls: Recorded[] = [];
  const query = <T>(text: string, values: unknown[] = []): Promise<{ rows: T[] }> => {
    calls.push({ text, values });
    return Promise.resolve({ rows: [{ total: 0, listing_total: 0 }] as T[] });
  };
  return { calls, query, connect: () => Promise.resolve({ query, release: () => undefined }) };
}

const PATHS = [
  ['/listings', {}],
  ['/listings/map', { bounds: '-77.06,38.88,-77.03,38.91' }],
  ['/listings/neighborhoods', { city: 'Washington', state: 'DC' }],
  ['/listings/zips', { city: 'Washington', state: 'DC' }],
  ['/listings/brokers', { city: 'Washington', state: 'DC' }],
] as const;

describe('area on every read path (#747)', () => {
  it.each(PATHS)('%s sends the shape to the database', async (path, extra) => {
    const pool = recordingPool();
    await request(createApp({ pool, mapPinCap: 10 }))
      .get(path)
      .query({ ...extra, area: SHAPE });

    const withShape = pool.calls.filter((call) => call.text.includes('ST_Covers('));
    expect(withShape.length).toBeGreaterThan(0);
    for (const call of withShape) {
      expect(call.values).toContainEqual(SHAPE);
    }
  });

  it.each(PATHS)(
    '%s answers 400 for a self-intersecting shape, with no query',
    async (path, extra) => {
      const pool = recordingPool();
      const response = await request(createApp({ pool, mapPinCap: 10 }))
        .get(path)
        .query({ ...extra, area: BOWTIE });

      expect(response.status).toBe(400);
      expect(pool.calls).toHaveLength(0);
    },
  );
});
