import { coordKeyOf, FAN_CAP_PX, fanOffsets, pillWidth } from './map-pins';

describe('pillWidth', () => {
  it('never goes below the 44px tap target', () => {
    expect(pillWidth('$9')).toBe(44);
  });

  it('grows with the label', () => {
    expect(pillWidth('$2.1K/mo')).toBeGreaterThan(pillWidth('$585K'));
  });
});

const units = (count: number, key = 'k') =>
  Array.from({ length: count }, (_, i) => ({
    id: `u${String(i).padStart(3, '0')}`,
    coordKey: key,
  }));

describe('coordKeyOf', () => {
  it('treats coordinates that agree to five decimals as one', () => {
    expect(coordKeyOf(38.800001, -77.1)).toBe(coordKeyOf(38.800004, -77.1));
    expect(coordKeyOf(38.8, -77.1)).not.toBe(coordKeyOf(38.8001, -77.1));
  });
});

describe('fanOffsets (#554, #557)', () => {
  it('moves nothing when no two homes share a coordinate', () => {
    const points = [
      { id: 'a', coordKey: '1' },
      { id: 'b', coordKey: '2' },
    ];
    expect(fanOffsets(points).size).toBe(0);
  });

  it('keeps the first home on the coordinate and gives each other home its own spot', () => {
    const offsets = fanOffsets(units(20));

    expect(offsets.has('u000')).toBe(false);
    expect(offsets.size).toBe(19);
    expect(new Set([...offsets.values()].map((o) => `${o.dx},${o.dy}`)).size).toBe(19);
  });

  it('keeps every home within the cap, and leaves the homes past the last spot on the coordinate', () => {
    const offsets = fanOffsets(units(80));

    for (const { dx, dy } of offsets.values()) {
      expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(FAN_CAP_PX + 1);
    }
    // 3 rings, 44 spots, plus the home on the coordinate.
    expect(offsets.size).toBe(44);
  });

  it('does not mix two coordinates', () => {
    const offsets = fanOffsets([
      ...units(3, 'a'),
      ...units(1, 'b').map((p) => ({ ...p, id: 'z' })),
    ]);

    expect(offsets.has('z')).toBe(false);
    expect(offsets.size).toBe(2);
  });
});
