import { backToGroupsUrl, neighborhoodDrillUrl, scopeOf } from './neighborhood-url';

describe('the map view is not carried to another place (#558)', () => {
  const bounds = 'bounds=-77.0602,38.7977,-77.0301,38.8189';
  const oldTown = { name: 'Old Town', city: 'Alexandria', state: 'VA' };

  it('drops bounds on a drill-down', () => {
    const url = neighborhoodDrillUrl({
      target: oldTown,
      type: 'sale',
      scope: scopeOf({ kind: 'city', city: 'Alexandria', state: 'VA' }, {}, oldTown),
      groupedType: 'sale',
      carried: new URLSearchParams(`groupBy=neighborhood&${bounds}&beds=2`),
    });

    expect(url).toBe('/alexandria-va/old-town-neighborhood/homes-for-sale?beds=2');
  });

  it('drops bounds on the way back to the groups', () => {
    const url = backToGroupsUrl({
      target: { city: 'Alexandria', state: 'VA' },
      type: 'sale',
      current: new URLSearchParams(`${bounds}&beds=2`),
    });

    expect(url).not.toContain('bounds');
  });
});
