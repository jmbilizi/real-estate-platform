import { groupRequestQuery, parseGroupState, writeGroupState } from './group-by';

describe('group state in the URL (#502)', () => {
  it('reads `from` on a neighborhood path (#533)', () => {
    expect(parseGroupState(new URLSearchParams('from=VA.all')).from).toBe('VA.all');
    expect(parseGroupState(new URLSearchParams('groupFrom=%7CMD')).from).toBeUndefined();
  });

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
});
