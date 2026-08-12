import { MockListing } from './types';
import {
  combineDateAndTime,
  communityKeyFor,
  communityNameFor,
  groupListingsByCommunity,
  isSubdivided,
  mapToCommunityRow,
  mapToListingRow,
  mapToMediaRows,
  mapToOpenHouseRow,
  mapToPropertyRow,
  mapToUnitRow,
  offerKindFor,
  splitBaths,
  validateAmenities,
} from './transform';

function buildMockListing(overrides: Partial<MockListing> = {}): MockListing {
  return {
    id: '1',
    title: 'Test Listing',
    address: '123 Main St',
    city: 'Baltimore',
    state: 'MD',
    zip: '21201',
    neighborhood: 'Downtown',
    price: 500000,
    status: 'Active',
    listingType: 'sale',
    source: 'brightMLS',
    propertyType: 'Single Family',
    beds: 3,
    baths: 2.5,
    sqft: 2000,
    lotSqft: 5000,
    yearBuilt: 1990,
    imageUrls: ['https://example.com/a.jpg', 'https://example.com/b.jpg'],
    brokerName: 'Jane Broker',
    brokerPhone: '(555) 555-0100',
    brokerEmail: 'jane@example.com',
    officeName: 'Example Realty',
    officeBrokerLeadPhone: '(555) 555-0000',
    officeBrokerLeadMail: 'lead@example.com',
    lastUpdated: '2026-01-01T00:00:00Z',
    description: 'A lovely home.',
    amenities: ['Pool', 'Garage'],
    latitude: 39.29,
    longitude: -76.61,
    featured: true,
    openHouse: { date: '2026-02-01', startTime: '1:00 PM', endTime: '3:00 PM' },
    priceReduced: false,
    newConstruction: false,
    ...overrides,
  };
}

describe('validateAmenities', () => {
  it('passes through a list of valid amenities unchanged', () => {
    expect(validateAmenities(['Pool', 'Garage', 'EV Charging'])).toEqual([
      'Pool',
      'Garage',
      'EV Charging',
    ]);
  });

  it('accepts an empty amenity list', () => {
    expect(validateAmenities([])).toEqual([]);
  });

  it('throws when given an amenity outside the fixed enum', () => {
    expect(() => validateAmenities(['Pool', 'Hot Tub'])).toThrow(/Invalid amenity/);
  });

  it('names every invalid value in the error message', () => {
    expect(() => validateAmenities(['Hot Tub', 'Sauna'])).toThrow(/Hot Tub, Sauna/);
  });

  it('rejects a Fair Housing steering phrase dressed up as an amenity', () => {
    // The database now enforces the same closed set via a CHECK; this is the app-layer half.
    expect(() => validateAmenities(['great for families'])).toThrow(/Invalid amenity/);
  });
});

describe('communityKeyFor / communityNameFor', () => {
  it('builds a stable grouping key from neighborhood, city, and state', () => {
    const listing = buildMockListing({
      neighborhood: 'Fells Point',
      city: 'Baltimore',
      state: 'MD',
    });
    expect(communityKeyFor(listing)).toBe('Fells Point|Baltimore|MD');
  });

  it('builds a human-readable community name', () => {
    const listing = buildMockListing({ neighborhood: 'Fells Point', city: 'Baltimore' });
    expect(communityNameFor(listing)).toBe('Fells Point, Baltimore');
  });
});

describe('groupListingsByCommunity', () => {
  it('groups listings that share a neighborhood/city/state under one key', () => {
    const a = buildMockListing({ id: '1', neighborhood: 'Fells Point' });
    const b = buildMockListing({ id: '2', neighborhood: 'Fells Point' });
    const c = buildMockListing({
      id: '3',
      neighborhood: 'Old Town',
      city: 'Alexandria',
      state: 'VA',
    });

    const groups = groupListingsByCommunity([a, b, c]);

    expect(groups.size).toBe(2);
    expect(groups.get('Fells Point|Baltimore|MD')).toEqual([a, b]);
    expect(groups.get('Old Town|Alexandria|VA')).toEqual([c]);
  });

  it('returns an empty map for an empty input', () => {
    expect(groupListingsByCommunity([]).size).toBe(0);
  });
});

describe('mapToCommunityRow', () => {
  it('maps an id and derived name into a community row, labelled as sample', () => {
    const listing = buildMockListing({ neighborhood: 'Eastport', city: 'Annapolis' });
    expect(mapToCommunityRow('community-1', listing)).toEqual({
      id: 'community-1',
      name: 'Eastport, Annapolis',
      // PRD §6.3 — sample labelling now exists at every level that can be displayed on its own.
      is_sample: true,
    });
  });
});

describe('splitBaths', () => {
  it.each([
    [2.5, 2, 1],
    [4, 4, 0],
    [1, 1, 0],
    [3.5, 3, 1],
  ])('decomposes %s into %s full and %s half', (baths, full, half) => {
    expect(splitBaths(baths)).toEqual({ baths_full: full, baths_half: half });
  });

  it('round-trips to the displayed decimal', () => {
    // baths_display is a generated column computed as full + 0.5 * half, so the split must reproduce it.
    const { baths_full, baths_half } = splitBaths(2.5);
    expect(baths_full + 0.5 * baths_half).toBe(2.5);
  });
});

describe('isSubdivided', () => {
  it('is true when the address carries a unit designator', () => {
    expect(isSubdivided(buildMockListing({ address: '800 F St NW Unit 1201' }))).toBe(true);
  });

  it('is false for a whole-property address', () => {
    expect(isSubdivided(buildMockListing({ address: '1200 Harbor View Dr' }))).toBe(false);
  });
});

describe('offerKindFor', () => {
  it.each([
    ['sale', 'sale'],
    ['rent', 'rent'],
    // 'sold' is a lifecycle state, not a kind of offer — a sold listing was a SALE that closed. Storing
    // it as a type is what made a sold rental unrepresentable.
    ['sold', 'sale'],
  ])('maps listingType %s to offer kind %s', (listingType, expected) => {
    expect(offerKindFor(buildMockListing({ listingType: listingType as never }))).toBe(expected);
  });
});

describe('mapToPropertyRow', () => {
  it('holds the dwelling facts when the property is NOT subdivided', () => {
    const listing = buildMockListing({
      address: '1200 Harbor View Dr',
      beds: 5,
      baths: 4,
      sqft: 4200,
    });

    const row = mapToPropertyRow('property-1', 'community-1', listing);

    // This is the defect this whole change exists to fix: a single-family home now has a durable home
    // for its beds/baths, independent of any listing.
    expect(row.beds).toBe(5);
    expect(row.baths_full).toBe(4);
    expect(row.baths_half).toBe(0);
    expect(row.living_sqft).toBe(4200);
  });

  it('leaves the dwelling facts to the unit when the property IS subdivided', () => {
    const listing = buildMockListing({ address: '800 F St NW Unit 1201', beds: 2, sqft: 1450 });

    const row = mapToPropertyRow('property-1', 'community-1', listing);

    expect(row.beds).toBeNull();
    expect(row.baths_full).toBeNull();
    expect(row.baths_half).toBeNull();
    expect(row.living_sqft).toBeNull();
  });

  it('strips the unit designator from street_line but keeps the raw address for lineage', () => {
    const listing = buildMockListing({ address: '800 F St NW Unit 1201' });

    const row = mapToPropertyRow('property-1', 'community-1', listing);

    expect(row.street_line).toBe('800 F St NW');
    expect(row.address_raw).toBe('800 F St NW Unit 1201');
  });

  it('gives two spellings of the same building the same address_key', () => {
    const a = mapToPropertyRow(
      'p1',
      null,
      buildMockListing({ address: '800 F Street NW', zip: '20004' }),
    );
    const b = mapToPropertyRow(
      'p2',
      null,
      buildMockListing({ address: '800 F St NW', zip: '20004' }),
    );
    expect(a.address_key).toBe(b.address_key);
  });

  it('keeps site facts on the property, including lot size and neighborhood', () => {
    const row = mapToPropertyRow('property-1', 'community-1', buildMockListing());
    expect(row.lot_sqft).toBe(5000);
    expect(row.neighborhood).toBe('Downtown');
    expect(row.year_built).toBe(1990);
    expect(row.zip5).toBe('21201');
    expect(row.is_sample).toBe(true);
  });
});

describe('mapToUnitRow', () => {
  it('returns null for a property held as a single dwelling (units stay optional per PRD §3)', () => {
    expect(
      mapToUnitRow('unit-1', 'property-1', buildMockListing({ address: '1200 Harbor View Dr' })),
    ).toBeNull();
  });

  it('carries the unit dwelling facts when the address names a sub-unit', () => {
    const listing = buildMockListing({
      address: '800 F St NW Unit 1201',
      beds: 2,
      baths: 2,
      sqft: 1450,
    });

    expect(mapToUnitRow('unit-1', 'property-1', listing)).toEqual({
      id: 'unit-1',
      property_id: 'property-1',
      unit_number: '1201',
      floor: null,
      beds: 2,
      baths_full: 2,
      baths_half: 0,
      living_sqft: 1450,
      is_sample: true,
    });
  });
});

describe('mapToListingRow', () => {
  it('splits offer kind from lifecycle and maps the consumer status to a feed status', () => {
    const row = mapToListingRow(
      'l1',
      'p1',
      null,
      buildMockListing({ status: 'Sold', listingType: 'sold' }),
    );

    expect(row.offer_kind).toBe('sale');
    expect(row.consumer_status).toBe('Sold');
    // 'Sold' is our consumer label; 'Closed' is what RESO/Bright actually send.
    expect(row.status).toBe('Closed');
  });

  it('forces source to internal and is_sample true regardless of the mock data', () => {
    const row = mapToListingRow('l1', 'p1', null, buildMockListing({ source: 'brightMLS' }));
    expect(row.source).toBe('internal');
    expect(row.is_sample).toBe(true);
    // Sample copy is ours, not MLS remarks — mislabelling it would assert MLS provenance falsely.
    expect(row.description_source).toBe('internal');
  });

  it('carries the dwelling snapshot and the full attribution block', () => {
    const row = mapToListingRow('l1', 'p1', 'u1', buildMockListing());

    expect(row).toMatchObject({
      beds: 3,
      baths_full: 2,
      baths_half: 1,
      living_sqft: 2000,
      lot_sqft: 5000,
      city: 'Baltimore',
      state: 'MD',
      zip5: '21201',
      broker_name: 'Jane Broker',
      broker_phone: '(555) 555-0100',
      broker_email: 'jane@example.com',
      office_name: 'Example Realty',
      listing_agent_name: 'Jane Broker',
    });
  });

  it('no longer carries open-house columns — those are their own table now', () => {
    const row = mapToListingRow('l1', 'p1', null, buildMockListing());
    expect(row).not.toHaveProperty('open_house_date');
    expect(row).not.toHaveProperty('open_house_start_time');
    expect(row).not.toHaveProperty('image_urls');
  });

  it('carries close price and date only when the listing has closed', () => {
    const open = mapToListingRow('l1', 'p1', null, buildMockListing());
    expect(open.close_price).toBeNull();
    expect(open.close_date).toBeNull();

    const closed = mapToListingRow(
      'l2',
      'p1',
      null,
      buildMockListing({
        status: 'Sold',
        listingType: 'sold',
        closePrice: 480000,
        closeDate: '2025-06-01',
      }),
    );
    expect(closed.close_price).toBe(480000);
    expect(closed.close_date).toBe('2025-06-01');
  });
});

describe('combineDateAndTime', () => {
  it.each([
    ['2026-02-01', '1:00 PM', '2026-02-01T13:00:00Z'],
    ['2026-02-01', '11:00 AM', '2026-02-01T11:00:00Z'],
    ['2026-02-01', '12:00 PM', '2026-02-01T12:00:00Z'],
    ['2026-02-01', '12:30 AM', '2026-02-01T00:30:00Z'],
  ])('combines %s %s into %s', (date, time, expected) => {
    expect(combineDateAndTime(date, time)).toBe(expected);
  });

  it('throws on an unparseable time rather than silently producing a bad instant', () => {
    expect(() => combineDateAndTime('2026-02-01', 'noon')).toThrow(/Unrecognized open-house time/);
  });
});

describe('mapToOpenHouseRow', () => {
  it('maps the single mock open house to a child row with real instants', () => {
    expect(mapToOpenHouseRow('oh1', 'l1', buildMockListing())).toEqual({
      id: 'oh1',
      listing_id: 'l1',
      starts_at: '2026-02-01T13:00:00Z',
      ends_at: '2026-02-01T15:00:00Z',
      // The mock shape carries no showing remarks; inventing some would be fabricated
      // consumer-visible copy, so null is the honest value rather than a placeholder string.
      remarks: null,
      is_cancelled: false,
      is_sample: true,
    });
  });

  it('returns null when the listing has no open house', () => {
    expect(mapToOpenHouseRow('oh1', 'l1', buildMockListing({ openHouse: null }))).toBeNull();
  });
});

describe('mapToMediaRows', () => {
  it('preserves gallery order explicitly and marks the first image primary', () => {
    const rows = mapToMediaRows(['m1', 'm2'], 'l1', buildMockListing());

    expect(rows).toEqual([
      {
        id: 'm1',
        listing_id: 'l1',
        source_url: 'https://example.com/a.jpg',
        sort_order: 0,
        is_primary: true,
        is_sample: true,
      },
      {
        id: 'm2',
        listing_id: 'l1',
        source_url: 'https://example.com/b.jpg',
        sort_order: 1,
        is_primary: false,
        is_sample: true,
      },
    ]);
  });

  it('throws rather than emitting a row with an undefined id', () => {
    expect(() => mapToMediaRows(['m1'], 'l1', buildMockListing())).toThrow(/one id per image/);
  });
});
