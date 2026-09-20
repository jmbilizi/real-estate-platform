import { type ListingStatusLookup, mapStandardStatus } from './status';

const STATUSES: readonly ListingStatusLookup[] = [
  { code: 'Active', consumerStatus: 'Active', isTerminal: false, resoStandardStatus: 'Active' },
  { code: 'Closed', consumerStatus: 'Sold', isTerminal: true, resoStandardStatus: 'Closed' },
  { code: 'Withdrawn', consumerStatus: null, isTerminal: true, resoStandardStatus: 'Withdrawn' },
  {
    code: 'Temporarily Off Market',
    consumerStatus: null,
    isTerminal: false,
    resoStandardStatus: 'Hold',
  },
];

describe('mapStandardStatus', () => {
  it('matches an exact code', () => {
    expect(mapStandardStatus('Active', STATUSES)).toEqual({
      code: 'Active',
      consumerStatus: 'Active',
      isTerminal: false,
    });
  });

  it('matches via reso_standard_status when the code differs from the feed value', () => {
    expect(mapStandardStatus('Hold', STATUSES)).toEqual({
      code: 'Temporarily Off Market',
      consumerStatus: null,
      isTerminal: false,
    });
  });

  it('fails closed on an unrecognised value', () => {
    expect(mapStandardStatus('Registered', STATUSES)).toBeNull();
  });

  it('fails closed on a missing value', () => {
    expect(mapStandardStatus(undefined, STATUSES)).toBeNull();
    expect(mapStandardStatus(null, STATUSES)).toBeNull();
    expect(mapStandardStatus('', STATUSES)).toBeNull();
  });

  it('is case-sensitive: Bright vocabulary is exact-match, never fuzzy', () => {
    expect(mapStandardStatus('active', STATUSES)).toBeNull();
  });
});
