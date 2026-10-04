import { buildFactGroups } from './listing-facts';

const none = {
  parking: null,
  heating: null,
  cooling: null,
  appliances: null,
  basement: null,
  flooring: null,
  interior: null,
  exterior: null,
};
const base = {
  facts: none,
  taxAnnualAmount: null,
  taxYear: null,
  hoaFee: null,
  hoaFeeFrequency: null,
};

describe('buildFactGroups', () => {
  it('returns no group when nothing is known', () => {
    expect(buildFactGroups(base)).toEqual([]);
  });

  it('drops empty and blank lists', () => {
    expect(buildFactGroups({ ...base, facts: { ...none, heating: [], cooling: [' '] } })).toEqual(
      [],
    );
  });

  it('groups list facts and keeps only the rows with data', () => {
    const groups = buildFactGroups({
      ...base,
      facts: { ...none, heating: ['Forced Air'], cooling: ['Central A/C', 'Ceiling Fan(s)'] },
    });
    expect(groups).toEqual([
      {
        id: 'heating-cooling',
        title: 'Heating & cooling',
        rows: [
          { label: 'Heating', value: 'Forced Air' },
          { label: 'Cooling', value: 'Central A/C, Ceiling Fan(s)' },
        ],
      },
    ]);
  });

  it('formats tax and HOA, and omits a zero amount', () => {
    const [group] = buildFactGroups({
      ...base,
      taxAnnualAmount: 4210.4,
      taxYear: 2025,
      hoaFee: 250,
      hoaFeeFrequency: 'Monthly',
    });
    expect(group.rows).toEqual([
      { label: 'Annual taxes', value: '$4,210 (2025)' },
      { label: 'HOA fee', value: '$250 monthly' },
    ]);
    expect(buildFactGroups({ ...base, taxAnnualAmount: 0, hoaFee: 0 })).toEqual([]);
  });
});
