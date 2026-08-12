import { applyAddressSuppression } from './suppression';
import { detailFixture } from './test-fixtures';

describe('applyAddressSuppression', () => {
  it('nulls unit.unitNumber when the view masked the address', () => {
    // The view builds address as `street_line || ' ' || unit_number`, so emitting the unit number
    // next to city/state/zip makes an opted-out condo's address reconstructible.
    const detail = detailFixture({ address: null, unitNumber: '4B' });
    expect(applyAddressSuppression(detail).unit?.unitNumber).toBeNull();
  });

  it('leaves the unit number alone when the address was published', () => {
    const detail = detailFixture({ address: '900 King St 4B', unitNumber: '4B' });
    expect(applyAddressSuppression(detail).unit?.unitNumber).toBe('4B');
  });

  it('is a no-op for a non-subdivided home', () => {
    const detail = detailFixture({ address: null, unitNumber: null, unit: null });
    expect(applyAddressSuppression(detail).unit).toBeNull();
  });
});
