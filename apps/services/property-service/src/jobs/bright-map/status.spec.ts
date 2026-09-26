import { type ListingStatusLookup, mapStandardStatus, searchableStatuses } from './status';

const STATUSES: readonly ListingStatusLookup[] = [
  {
    code: 'Active',
    consumerStatus: 'Active',
    isTerminal: false,
    resoStandardStatus: 'Active',
    isPubliclySearchable: true,
  },
  {
    code: 'Closed',
    consumerStatus: 'Sold',
    isTerminal: true,
    resoStandardStatus: 'Closed',
    isPubliclySearchable: true,
  },
  {
    code: 'Withdrawn',
    consumerStatus: null,
    isTerminal: true,
    resoStandardStatus: 'Withdrawn',
    isPubliclySearchable: false,
  },
  {
    code: 'Temporarily Off Market',
    consumerStatus: null,
    isTerminal: false,
    resoStandardStatus: 'Hold',
    isPubliclySearchable: false,
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

describe('searchableStatuses', () => {
  it('returns the reso_standard_status of every publicly searchable status', () => {
    expect(searchableStatuses(STATUSES)).toEqual(['Active', 'Closed']);
  });

  it('drops a searchable status with no reso_standard_status', () => {
    const noWireValue: readonly ListingStatusLookup[] = [
      {
        code: 'Active',
        consumerStatus: 'Active',
        isTerminal: false,
        resoStandardStatus: null,
        isPubliclySearchable: true,
      },
    ];
    expect(searchableStatuses(noWireValue)).toEqual([]);
  });

  it('de-duplicates two codes sharing one reso_standard_status', () => {
    const shared: readonly ListingStatusLookup[] = [
      {
        code: 'A',
        consumerStatus: 'Active',
        isTerminal: false,
        resoStandardStatus: 'Active',
        isPubliclySearchable: true,
      },
      {
        code: 'B',
        consumerStatus: 'Active',
        isTerminal: false,
        resoStandardStatus: 'Active',
        isPubliclySearchable: true,
      },
    ];
    expect(searchableStatuses(shared)).toEqual(['Active']);
  });
});
