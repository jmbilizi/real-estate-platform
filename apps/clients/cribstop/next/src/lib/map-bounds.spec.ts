import { formatBounds, roundBounds, sameBounds } from './map-bounds';

describe('map bounds helpers (#558)', () => {
  const oldTown = { west: -77.0602, south: 38.7977, east: -77.0301, north: 38.8189 };

  it('formats west,south,east,north', () => {
    expect(formatBounds(oldTown)).toBe('-77.06020,38.79770,-77.03010,38.81890');
  });

  it('clamps the edges a zoomed-out map reports past the globe', () => {
    expect(formatBounds({ west: -250, south: -95, east: 250, north: 95 })).toBe(
      '-180.00000,-90.00000,180.00000,90.00000',
    );
  });

  it('rounds to four decimals, so equal views compare equal', () => {
    const rounded = roundBounds({
      west: -77.060213,
      south: 38.797749,
      east: -77.030099,
      north: 38.8189,
    });

    expect(rounded).toEqual(oldTown);
    expect(sameBounds(rounded, roundBounds({ ...oldTown, west: oldTown.west + 0.000004 }))).toBe(
      true,
    );
  });

  it('compares absent bounds', () => {
    expect(sameBounds(undefined, undefined)).toBe(true);
    expect(sameBounds(oldTown, undefined)).toBe(false);
  });
});
