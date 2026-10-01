import {
  backToGroupFilters,
  drillDownFilters,
  groupRequestQuery,
  parseGroupState,
  writeGroupState,
} from './group-by';

describe('group state in the URL (#502)', () => {
  it('round-trips group by and order', () => {
    const params = writeGroupState(new URLSearchParams('q=x'), {
      groupBy: 'neighborhood',
      order: 'name',
    });
    expect(params.toString()).toBe('q=x&groupBy=neighborhood&groupOrder=name');
    expect(parseGroupState(params)).toEqual({ groupBy: 'neighborhood', order: 'name' });
  });

  it('leaves defaults out and ignores unknown values', () => {
    const params = writeGroupState(new URLSearchParams('groupOrder=name'), {
      groupBy: undefined,
      order: 'name',
    });
    expect(params.toString()).toBe('');
    expect(parseGroupState(new URLSearchParams('groupBy=price&groupOrder=x'))).toEqual({
      groupBy: undefined,
      order: 'count',
    });
  });
});

describe('group requests and drill-down (#502)', () => {
  it('drops sort and adds minCount, limit, offset and order', () => {
    expect(groupRequestQuery({ beds: 2, sort: 'price-asc' }, 3, 'name')).toEqual({
      beds: 2,
      minCount: 1,
      limit: 24,
      offset: 48,
      order: 'name',
    });
  });

  it('sets neighborhood, city and state together and keeps other filters', () => {
    expect(
      drillDownFilters({ beds: 2, query: 'MD' }, { name: 'A', city: 'B', state: 'MD' }),
    ).toEqual({ beds: 2, query: 'MD', neighborhood: 'A', city: 'B', state: 'MD' });
  });

  it('goes back by clearing the neighborhood, and the place when a scope remains', () => {
    expect(
      backToGroupFilters({ query: 'MD', neighborhood: 'A', city: 'B', state: 'MD', beds: 2 }),
    ).toEqual({ query: 'MD', beds: 2 });
    expect(backToGroupFilters({ neighborhood: 'A', city: 'B', state: 'MD' })).toEqual({
      city: 'B',
      state: 'MD',
    });
  });
});
