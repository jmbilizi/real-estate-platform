import {
  groupRequestQuery,
  parseGroupState,
  writeGroupState,
  zipOptionAvailable,
  zipProbeQuery,
} from './group-by';

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

describe('ZIP code grouping in the URL (#722)', () => {
  it('reads and writes groupBy=zip and the drill that the chip returns to', () => {
    const params = writeGroupState(new URLSearchParams('q=x'), {
      groupBy: 'zip',
      order: 'name',
    });
    expect(params.toString()).toBe('q=x&groupBy=zip&groupOrder=name');
    expect(parseGroupState(params)).toMatchObject({ groupBy: 'zip', order: 'name' });

    const drilled = writeGroupState(new URLSearchParams('zip=20814'), {
      groupBy: undefined,
      order: 'count',
      drill: 'zip',
    });
    expect(drilled.toString()).toBe('zip=20814&groupDrill=zip');
    expect(parseGroupState(drilled)).toMatchObject({ groupBy: undefined, drill: 'zip' });
  });

  it('reads an unknown groupBy or groupDrill as no grouping', () => {
    expect(parseGroupState(new URLSearchParams('groupBy=office')).groupBy).toBeUndefined();
    expect(parseGroupState(new URLSearchParams('groupBy=ZIP')).groupBy).toBeUndefined();
    expect(parseGroupState(new URLSearchParams('groupDrill=x')).drill).toBeUndefined();
  });

  it('reads and writes groupBy=broker with the drill label, and never groups by it by default', () => {
    const grouped = writeGroupState(new URLSearchParams('q=x'), {
      groupBy: 'broker',
      order: 'count',
    });
    expect(grouped.toString()).toBe('q=x&groupBy=broker');
    expect(parseGroupState(grouped).groupBy).toBe('broker');

    const drilled = writeGroupState(new URLSearchParams('officeKey=1001'), {
      groupBy: undefined,
      order: 'count',
      drill: 'broker',
      drillLabel: 'Acme Realty',
    });
    expect(drilled.toString()).toBe('officeKey=1001&groupDrill=broker&groupLabel=Acme+Realty');
    expect(parseGroupState(drilled)).toMatchObject({ drill: 'broker', drillLabel: 'Acme Realty' });

    expect(parseGroupState(new URLSearchParams('')).groupBy).toBeUndefined();
    // A ZIP drill carries no label.
    expect(
      writeGroupState(new URLSearchParams(), {
        groupBy: undefined,
        order: 'count',
        drill: 'zip',
        drillLabel: 'x',
      }).toString(),
    ).toBe('groupDrill=zip');
  });

  it('never groups by default', () => {
    expect(parseGroupState(new URLSearchParams('')).groupBy).toBeUndefined();
    expect(writeGroupState(new URLSearchParams(), parseGroupState(new URLSearchParams()))).toEqual(
      new URLSearchParams(),
    );
  });

  it('builds the probe as a one-group request and offers ZIP only above one ZIP code', () => {
    expect(zipProbeQuery({ beds: 2, sort: 'price-asc' })).toEqual({
      beds: 2,
      minCount: 1,
      limit: 1,
      offset: 0,
      order: 'count',
    });
    expect(zipOptionAvailable(null)).toBe(false);
    expect(zipOptionAvailable(0)).toBe(false);
    expect(zipOptionAvailable(1)).toBe(false);
    expect(zipOptionAvailable(2)).toBe(true);
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
