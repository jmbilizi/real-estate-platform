import { searchRequestSchema } from '@cribstop/property-contracts';
import { collapseCondition } from './collapse';
import { buildSearchQuery, isScopeOnlyRequest } from './search-query';

const build = (query: Record<string, unknown> = {}): ReturnType<typeof buildSearchQuery> => {
  const plan = buildSearchQuery(searchRequestSchema.parse(query));
  return { ...plan, where: plan.where.replace(collapseCondition(), 'TRUE') };
};

describe('area (#747)', () => {
  const area = JSON.stringify({
    type: 'Polygon',
    coordinates: [
      [
        [-77.05, 38.89],
        [-77.04, 38.89],
        [-77.04, 38.9],
        [-77.05, 38.89],
      ],
    ],
  });

  it('adds no condition when area is absent', () => {
    expect(build({ city: 'Alexandria' }).where).not.toContain('ST_Covers');
  });

  it('adds a point-in-polygon test on v.geog and binds the shape', () => {
    const { where, params } = build({ area });
    expect(where).toContain('ST_Covers(ST_GeomFromGeoJSON(');
    expect(where).toContain('::geography, v.geog)');
    expect(params).toContainEqual(area);
  });

  it('prunes with the padded bounding box before the geodesic test', () => {
    const { where, params } = build({ area });
    expect(where.indexOf('v.latitude BETWEEN')).toBeLessThan(where.indexOf('ST_Covers('));
    expect(params).toContainEqual(38.89 - 0.01);
    expect(params).toContainEqual(38.9 + 0.01);
    expect(params).toContainEqual(-77.05 - 0.01);
    expect(params).toContainEqual(-77.04 + 0.01);
  });

  it('is not a scope-only request, so the group counts use the view and the shape', () => {
    expect(isScopeOnlyRequest(searchRequestSchema.parse({ city: 'Washington' }))).toBe(true);
    expect(isScopeOnlyRequest(searchRequestSchema.parse({ city: 'Washington', area }))).toBe(false);
  });

  it('ANDs with boundary and bounds', () => {
    const { where } = build({ area, boundary: area, bounds: '-77.07,38.79,-77.03,38.83' });
    expect(where).toContain('ST_Intersects(v.geog,');
    expect(where).toContain('ST_Covers(');
    expect(where).toContain('v.latitude BETWEEN');
  });
});
