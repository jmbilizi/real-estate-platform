import { toSearchParams } from './listings';

describe('toSearchParams with bounds (#558)', () => {
  it('serializes the viewport as west,south,east,north, clamped', () => {
    const params = toSearchParams({
      city: 'Alexandria',
      bounds: { west: -77.0602, south: 38.7977, east: -77.0301, north: 38.8189 },
    });

    expect(params.get('bounds')).toBe('-77.06020,38.79770,-77.03010,38.81890');
    expect(params.get('city')).toBe('Alexandria');
  });
});
