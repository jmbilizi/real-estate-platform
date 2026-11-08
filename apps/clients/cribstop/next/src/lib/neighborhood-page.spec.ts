import type { NeighborhoodRow } from '@cribstop/property-contracts';
import {
  NEARBY_NEIGHBORHOODS_MAX,
  nearbyNeighborhoods,
  neighborhoodBreadcrumbs,
} from './neighborhood-page';

const row = (name: string, total: number, city = 'Alexandria'): NeighborhoodRow => ({
  key: `va|${city.toLowerCase()}|${name.toLowerCase()}`,
  name,
  city,
  state: 'VA',
  slug: name.toLowerCase().replace(/ /g, '-'),
  total,
  sale: total,
  rent: 0,
  centroid: null,
  bounds: null,
});

const CURRENT = { name: 'Del Ray', city: 'Alexandria', state: 'VA' };

describe('neighborhoodBreadcrumbs (#974)', () => {
  it('lists Home, City, Neighborhood', () => {
    const place = { kind: 'neighborhood' as const, ...CURRENT };
    expect(
      neighborhoodBreadcrumbs(
        place,
        'Del Ray',
        { city: 'Alexandria', state: 'VA' },
        'homes-for-sale',
      ),
    ).toEqual([
      { name: 'Home', path: '/' },
      { name: 'Alexandria, VA', path: '/alexandria-va/homes-for-sale' },
      { name: 'Del Ray', path: '/alexandria-va/del-ray-neighborhood/homes-for-sale' },
    ]);
  });
});

describe('nearbyNeighborhoods (#974)', () => {
  const rows = [
    row('Del Ray', 50),
    row('Old Town', 30),
    row('Rosemont', 30),
    row('Arlandria', 30),
    row('Seminary Hill', 4),
  ];

  it('drops the current neighborhood and any below the threshold', () => {
    const names = nearbyNeighborhoods(rows, CURRENT, 'homes-for-sale', 10).map((n) => n.name);
    expect(names).toEqual(['Arlandria', 'Old Town', 'Rosemont']);
  });

  it('orders by count descending, then by name', () => {
    const list = [row('Beta', 20), row('Alpha', 20), row('Gamma', 40)];
    const names = nearbyNeighborhoods(list, CURRENT, 'homes-for-sale', 1).map((n) => n.name);
    expect(names).toEqual(['Gamma', 'Alpha', 'Beta']);
  });

  it('keeps at most 8 links and builds the neighborhood path', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      row(`Area ${String(i).padStart(2, '0')}`, 20),
    );
    const out = nearbyNeighborhoods(many, CURRENT, 'homes-for-rent', 10);
    expect(out).toHaveLength(NEARBY_NEIGHBORHOODS_MAX);
    expect(out[0]?.path).toBe('/alexandria-va/area-00-neighborhood/homes-for-rent');
  });

  it('tells a same-name neighborhood of another city apart by key', () => {
    const list = [row('Del Ray', 20, 'Arlington')];
    expect(nearbyNeighborhoods(list, CURRENT, 'homes-for-sale', 1)).toHaveLength(1);
  });
});
