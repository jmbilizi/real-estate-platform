import { isSimpleRing } from './area-polygon';
import { searchRequestSchema } from './search-request';

describe('area polygon (#747)', () => {
  const ringOf = (points: number[][]): string =>
    JSON.stringify({ type: 'Polygon', coordinates: [[...points, points[0]]] });
  const square = ringOf([
    [-77.05, 38.89],
    [-77.04, 38.89],
    [-77.04, 38.9],
    [-77.05, 38.9],
  ]);
  const ok = (area: string): boolean => searchRequestSchema.safeParse({ area }).success;

  it('accepts a valid single-ring polygon, either winding', () => {
    expect(searchRequestSchema.parse({ area: square }).area).toBe(square);
    const clockwise = ringOf([
      [-77.05, 38.89],
      [-77.05, 38.9],
      [-77.04, 38.9],
      [-77.04, 38.89],
    ]);
    expect(ok(clockwise)).toBe(true);
  });

  it('rejects more than 200 vertices', () => {
    const many = Array.from({ length: 201 }, (_, i) => {
      const angle = (i / 201) * 2 * Math.PI;
      return [-77 + Math.cos(angle) * 0.01, 38.9 + Math.sin(angle) * 0.01];
    });
    expect(ok(ringOf(many))).toBe(false);
    expect(ok(ringOf(many.slice(0, 150)))).toBe(true);
  });

  it('rejects a string over 8000 characters', () => {
    const long = JSON.stringify({
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
      ],
      pad: 'x'.repeat(8000),
    });
    expect(ok(long)).toBe(false);
  });

  it('rejects an open ring', () => {
    const open = JSON.stringify({
      type: 'Polygon',
      coordinates: [
        [
          [-77.05, 38.89],
          [-77.04, 38.89],
          [-77.04, 38.9],
          [-77.05, 38.9],
        ],
      ],
    });
    expect(ok(open)).toBe(false);
  });

  it('rejects coordinates out of range, other types, and more than one ring', () => {
    const badLng = ringOf([
      [-200, 38.89],
      [-77.04, 38.89],
      [-77.04, 38.9],
    ]);
    const badLat = ringOf([
      [-77.05, 95],
      [-77.04, 38.89],
      [-77.04, 38.9],
    ]);
    expect(ok(badLng)).toBe(false);
    expect(ok(badLat)).toBe(false);
    expect(ok(JSON.stringify({ type: 'Point', coordinates: [-77, 38] }))).toBe(false);
    expect(ok('{not json')).toBe(false);
    const outer = (JSON.parse(square) as { coordinates: number[][][] }).coordinates[0];
    expect(ok(JSON.stringify({ type: 'Polygon', coordinates: [outer, outer] }))).toBe(false);
  });

  it('rejects a self-intersecting shape, a zero-area line and a spike', () => {
    const bowtie = ringOf([
      [0, 0],
      [2, 2],
      [2, 0],
      [0, 2],
    ]);
    const line = ringOf([
      [0, 0],
      [1, 1],
      [2, 2],
    ]);
    const spike = ringOf([
      [0, 0],
      [2, 0],
      [1, 0],
      [1, 1],
    ]);
    expect(ok(bowtie)).toBe(false);
    expect(ok(line)).toBe(false);
    expect(ok(spike)).toBe(false);
  });

  it('isSimpleRing agrees on a plain square and a repeated vertex', () => {
    expect(
      isSimpleRing([
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ]),
    ).toBe(true);
    expect(
      isSimpleRing([
        [0, 0],
        [1, 0],
        [1, 0],
        [1, 1],
        [0, 0],
      ]),
    ).toBe(false);
  });
});
