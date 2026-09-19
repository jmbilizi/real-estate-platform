import { isSampleFeed, withSampleSuffix } from './sample';

describe('isSampleFeed', () => {
  it('marks the test feed as sample', () => {
    expect(isSampleFeed('test')).toBe(true);
  });

  it('does not mark the production feed as sample', () => {
    expect(isSampleFeed('production')).toBe(false);
  });
});

describe('withSampleSuffix', () => {
  it('appends the disclosure suffix', () => {
    expect(withSampleSuffix('Condo in Arlington, VA')).toBe('Condo in Arlington, VA (Sample)');
  });

  it('is idempotent: re-processing does not double-suffix', () => {
    const once = withSampleSuffix('Condo in Arlington, VA');
    expect(withSampleSuffix(once)).toBe(once);
  });
});
