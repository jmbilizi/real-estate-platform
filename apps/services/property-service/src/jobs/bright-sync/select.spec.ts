import { mapBrightPropertyRecord, type MapContext } from '../bright-map/map-record';
import type { ListingStatusLookup } from '../bright-map/status';
import { BRIGHT_SYNC_SELECT } from './select';

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
];

const FULL: Record<string, unknown> = {
  ListingKey: 805336826404,
  ModificationTimestamp: '2026-09-26T21:09:14Z',
  StandardStatus: 'Active',
  PropertyType: 'Residential',
  PropertySubType: 'Detached',
  StructureDesignType: 'Detached',
  ListPrice: 725000,
  UnparsedAddress: '1400 Oak St NW',
  StreetNumber: '1400',
  StreetDirPrefix: null,
  StreetName: 'Oak',
  StreetSuffix: 'ST',
  StreetDirSuffix: 'NW',
  UnitNumber: '2',
  City: 'WASHINGTON',
  StateOrProvince: 'DC',
  PostalCode: '20009',
  SubdivisionName: 'COLUMBIA HEIGHTS',
  Latitude: 38.9,
  Longitude: -77.03,
  BedroomsTotal: 3,
  BathroomsFull: 2,
  BathroomsHalf: 1,
  LivingArea: 1800,
  LotSizeSquareFeet: 2000,
  YearBuilt: 1910,
  PublicRemarks: 'Row house.',
  ListPictureURL: 'http://example.test/1.jpg',
  InternetEntireListingDisplayYN: true,
  InternetAddressDisplayYN: true,
  ListAgentFullName: 'A Agent',
  ListAgentOfficePhone: '2025550100',
  ListOfficeName: 'Acme Realty',
  ListOfficePhone: '2025550101',
  ListOfficeEmail: 'office@acme.example',
};

/** Records every property name the mapper reads, including reads of absent fields. */
function recording(payload: Record<string, unknown>, reads: Set<string>): Record<string, unknown> {
  return new Proxy(payload, {
    get(target, key, receiver) {
      if (typeof key === 'string') reads.add(key);
      return Reflect.get(target, key, receiver);
    },
    has(target, key) {
      if (typeof key === 'string') reads.add(key);
      return Reflect.has(target, key);
    },
  });
}

const CTX: MapContext = { feed: 'production', statuses: STATUSES, soldDisplayDelayDays: 0 };

describe('BRIGHT_SYNC_SELECT', () => {
  it.each([
    ['an active sale', FULL],
    ['a lease', { ...FULL, PropertyType: 'Residential Lease' }],
    ['a structure-type fallback', { ...FULL, PropertySubType: null }],
    [
      'a sold record',
      { ...FULL, StandardStatus: 'Closed', ClosePrice: 700000, CloseDate: '2026-01-02' },
    ],
    ['a suppressed address', { ...FULL, InternetAddressDisplayYN: false }],
  ])('carries every field the mapper reads for %s', (_label, payload) => {
    const reads = new Set<string>();
    mapBrightPropertyRecord(recording(payload, reads), CTX);
    const fieldReads = [...reads].filter((key) => /^[A-Z]/.test(key));
    expect(fieldReads.filter((key) => !BRIGHT_SYNC_SELECT.includes(key))).toEqual([]);
  });

  it('maps the projected record exactly as the full record', () => {
    const projected = Object.fromEntries(
      Object.entries({ ...FULL, NotSelected: 'x' }).filter(([key]) =>
        BRIGHT_SYNC_SELECT.includes(key),
      ),
    );
    expect(mapBrightPropertyRecord(projected, CTX)).toEqual(mapBrightPropertyRecord(FULL, CTX));
  });
});
